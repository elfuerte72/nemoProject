import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { clients, referralCodes } from '@nemo/db';
import {
  REFERRAL_CODE_LIMIT,
  normalizeReferralCode,
  promoCodeSchema,
  type ReferralCodeKind,
} from '@nemo/types';
import { requireClient, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import { generateReferralCode } from './referral-code.js';

/**
 * Реферальные коды клиента: ссылки и промокоды (docs/adr/0019).
 *
 * Кодов несколько, у каждого название — «сторис», «канал», — чтобы по
 * ним читалась статистика: откуда приходят. Ссылка получает
 * сгенерированный код, промокод — слово, которое клиент выбрал сам.
 * Регистр не различается нигде: индекс базы и поиск сравнивают верхний.
 *
 * Архив вместо удаления: на код ссылаются приведённые им клиенты, и
 * статистика по ссылке не должна исчезать вместе с ней.
 */

export const PRIMARY_CODE_LABEL = 'Основная';

export interface ReferralCodeView {
  readonly id: string;
  readonly code: string;
  readonly kind: ReferralCodeKind;
  readonly label: string;
  readonly createdAt: Date;
  readonly archivedAt: Date | null;
}

export interface CreateReferralCodeInput {
  readonly kind: ReferralCodeKind;
  readonly label: string;
  /** Промокод — слово клиента; у ссылки код генерируется. */
  readonly code?: string | undefined;
}

type CodeRow = typeof referralCodes.$inferSelect;

function toView(row: CodeRow): ReferralCodeView {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    label: row.label,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  };
}

function requireLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 40) {
    throw new InvalidInputError('Название кода — от 1 до 40 знаков');
  }
  return trimmed;
}

/** Действующий код любого вида по слову, без учёта регистра. */
export async function findActiveCode(
  executor: Executor,
  code: string,
): Promise<CodeRow | undefined> {
  const normalized = normalizeReferralCode(code);
  if (normalized.length === 0) return undefined;
  const [row] = await executor
    .select()
    .from(referralCodes)
    .where(and(sql`upper(${referralCodes.code}) = ${normalized}`, isNull(referralCodes.archivedAt)))
    .limit(1);
  return row;
}

/**
 * Строка клиента под замком на время счёта: два запроса разом иначе
 * прочли бы одно и то же число кодов и оба прошли бы предел, а два
 * архива разом оставили бы клиента без единой ссылки. Тот же приём, что
 * у заявки на вывод.
 */
async function lockClient(executor: Executor, clientId: bigint): Promise<void> {
  const [row] = await executor
    .select({ id: clients.telegramUserId })
    .from(clients)
    .where(eq(clients.telegramUserId, clientId))
    .limit(1)
    .for('update');
  if (!row) {
    throw new NotFoundError('Клиент не найден');
  }
}

async function activeCodes(executor: Executor, clientId: bigint): Promise<CodeRow[]> {
  return executor
    .select()
    .from(referralCodes)
    .where(and(eq(referralCodes.clientId, clientId), isNull(referralCodes.archivedAt)))
    .orderBy(asc(referralCodes.createdAt), asc(referralCodes.id));
}

/**
 * Основной код — самая ранняя действующая ссылка. Её шлёт бот по
 * `/referral` и её же показывает лист «Пригласить»: у клиента, который
 * ничего не настраивал, ссылка одна, и она эта.
 *
 * Клиент без единой ссылки — не ошибка данных, а след выката: Mini App
 * старой сборки в окно между миграцией `0031` и своей пересборкой
 * заводил клиентов в прежнюю колонку, не зная о таблице кодов. Такому
 * ссылка заводится здесь, при первом же чтении, — иначе кабинет
 * отвечал бы ему отказом за то, в какую минуту он открыл приложение.
 */
export async function primaryReferralCode(executor: Executor, clientId: bigint): Promise<string> {
  const [row] = await executor
    .select({ code: referralCodes.code })
    .from(referralCodes)
    .where(
      and(
        eq(referralCodes.clientId, clientId),
        eq(referralCodes.kind, 'link'),
        isNull(referralCodes.archivedAt),
      ),
    )
    .orderBy(asc(referralCodes.createdAt), asc(referralCodes.id))
    .limit(1);
  if (row) return row.code;
  return insertPrimaryCode(executor, clientId);
}

/**
 * Ссылка со сгенерированным кодом. Столкновение случайных кодов —
 * событие на миллиарды, но не нулевое: при нём код генерируется заново.
 */
async function insertLink(executor: Executor, clientId: bigint, label: string): Promise<CodeRow> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [row] = await executor
      .insert(referralCodes)
      .values({ clientId, code: generateReferralCode(), kind: 'link', label })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
  }
  throw new ConflictError('Не удалось выдать код: попробуйте ещё раз');
}

/** Первая ссылка клиента — при регистрации, вместе со строкой клиента. */
export async function insertPrimaryCode(executor: Executor, clientId: bigint): Promise<string> {
  return (await insertLink(executor, clientId, PRIMARY_CODE_LABEL)).code;
}

/** Действующие коды клиента видом — для счёта и сводки, где актор уже проверен. */
export async function activeReferralCodes(
  executor: Executor,
  clientId: bigint,
): Promise<readonly ReferralCodeView[]> {
  return (await activeCodes(executor, clientId)).map(toView);
}

/**
 * Действующий код по слову — без актора: по нему маршрут Mini App рисует
 * QR ссылки, а ссылка и так публична. Отдаётся только код как записан,
 * чтобы картинка совпадала с экраном; владельца маршрут не узнаёт —
 * потому и не `findActiveCode` напрямую.
 */
export async function lookupReferralCode(ctx: CoreConfig, code: string): Promise<string | null> {
  const row = await findActiveCode(ctx.db, code);
  return row?.code ?? null;
}

export async function listReferralCodes(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly ReferralCodeView[]> {
  return activeReferralCodes(ctx.db, requireClient(actor));
}

export async function createReferralCode(
  ctx: CoreConfig,
  actor: Actor,
  input: CreateReferralCodeInput,
): Promise<ReferralCodeView> {
  const clientId = requireClient(actor);
  const label = requireLabel(input.label);

  return ctx.db.transaction(async (tx) => {
    await lockClient(tx, clientId);
    const [existing] = await tx
      .select({ n: count() })
      .from(referralCodes)
      .where(and(eq(referralCodes.clientId, clientId), isNull(referralCodes.archivedAt)));
    if ((existing?.n ?? 0) >= REFERRAL_CODE_LIMIT) {
      throw new InvalidInputError(
        `Действующих кодов не больше десяти: архивируйте ненужный, чтобы завести новый`,
      );
    }

    if (input.kind === 'link') {
      return toView(await insertLink(tx, clientId, label));
    }

    const parsed = promoCodeSchema.safeParse(input.code ?? '');
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? 'Промокод не подходит');
    }
    const [row] = await tx
      .insert(referralCodes)
      .values({ clientId, code: parsed.data, kind: 'promo', label })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      throw new ConflictError('Такой код уже занят — выберите другое слово');
    }
    return toView(row);
  });
}

export async function archiveReferralCode(
  ctx: CoreConfig,
  actor: Actor,
  id: string,
): Promise<void> {
  const clientId = requireClient(actor);
  await ctx.db.transaction(async (tx) => {
    await lockClient(tx, clientId);
    const codes = await activeCodes(tx, clientId);
    const target = codes.find((one) => one.id === id);
    if (!target) {
      throw new NotFoundError('Код не найден');
    }
    // Без единой ссылки звать некуда: «Пригласить» и бот отдают основную.
    if (target.kind === 'link' && codes.filter((one) => one.kind === 'link').length === 1) {
      throw new InvalidInputError('Последняя ссылка не архивируется: без неё некуда звать');
    }
    await tx
      .update(referralCodes)
      .set({ archivedAt: new Date() })
      .where(eq(referralCodes.id, id));
  });
}
