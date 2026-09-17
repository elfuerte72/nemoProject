import { and, asc, count, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { ambassadors, bonusTransactions, clients, referrals, staff } from '@nemo/db';
import { Money, isReferralLine, parseTelegramUserId, type Amount, type ReferralLine } from '@nemo/types';
import { requireAdmin, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors.js';
import { insertPrimaryCode } from './referral-codes.js';
import { readReferralProgram } from './referral-program.js';
import { cyrillicLike, likePattern } from './search.js';
import { recordSettingsChange } from './settings-audit.js';

/**
 * Амбассадор — клиент с отметкой: человек с аудиторией, которого сервис
 * позвал в программу поимённо (docs/adr/0022). Блогер, чат, канал.
 *
 * От обычного реферера он отличается тремя вещами, и все три —
 * снаружи, а не в устройстве: его заводит администратор, ставка у него
 * своя (`client_referral_rates`, как у любого клиента), и смотрит он
 * свои числа в браузере, а не в Mini App. Внутри это тот же клиент:
 * приводит своей ссылкой, баллы копятся на его счёте, и вторая
 * цепочка рефералов рядом с первой означала бы два счёта одних и тех
 * же денег.
 *
 * Право войти в кабинет решает отметка, а не подпись Telegram: подпись
 * говорит «этим аккаунтом владеет тот, кто нажал кнопку», и не больше.
 * Решает это ядро, а не маршрут: маршрут у кабинета не единственный.
 */

/** Подпись длиннее ста знаков — не подпись, а заметка: для неё есть `note`. */
const MAX_TITLE = 100;
const MAX_NOTE = 1000;

export interface AmbassadorSession {
  readonly clientId: bigint;
  readonly title: string;
  /** Первый вход. Пусто до него, дальше — тот самый, первый. */
  readonly firstSignedInAt: Date | null;
}

export interface AmbassadorView {
  readonly clientId: bigint;
  readonly title: string;
  readonly note: string | null;
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
  /** Когда входил первый раз; пусто — ключ выдан, а человек не дошёл. */
  readonly signedInAt: Date | null;
  /** Ник в Telegram, если сервис его видел: по нему пишут амбассадору. */
  readonly username: string | null;
  /** Приведённые по оплачиваемым линиям — как их считает программа. */
  readonly referredByLine: readonly { readonly line: ReferralLine; readonly count: number }[];
  /** Начислено всего — заработанное, а не остаток. */
  readonly accrued: Amount;
}

export interface AddAmbassadorInput {
  readonly telegramUserId: bigint;
  readonly title: string;
  readonly note?: string | undefined;
}

export interface ListAmbassadorsInput {
  /** Поиск по подписи и по идентификатору Telegram. */
  readonly query?: string | undefined;
}

function requireTitle(raw: string): string {
  const title = raw.trim();
  if (!title) {
    throw new InvalidInputError('Подпишите амбассадора: чей это канал или чат');
  }
  if (title.length > MAX_TITLE) {
    throw new InvalidInputError(`Подпись: не длиннее ${MAX_TITLE} знаков`);
  }
  return title;
}

function requireNote(raw: string | undefined): string | null {
  const note = raw?.trim();
  if (!note) return null;
  if (note.length > MAX_NOTE) {
    throw new InvalidInputError(`Заметка: не длиннее ${MAX_NOTE} знаков`);
  }
  return note;
}

/**
 * Заведение отметки поднимает и самого клиента, если его ещё нет.
 *
 * Блогер мог никогда не открывать Mini App, а реферальная ссылка нужна
 * ему в день заведения — иначе звать в программу нечем. Пустая запись
 * клиента без заявок безвредна; ошибка в цифре лечится снятием
 * отметки.
 */
export async function addAmbassador(
  ctx: CoreConfig,
  actor: Actor,
  input: AddAmbassadorInput,
): Promise<AmbassadorView> {
  const admin = requireAdmin(actor);
  const title = requireTitle(input.title);
  const note = requireNote(input.note);
  const clientId = input.telegramUserId;
  if (clientId <= 0n) {
    throw new InvalidInputError('Telegram ID — целое положительное число');
  }

  await ctx.db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(clients)
      .values({ telegramUserId: clientId })
      .onConflictDoNothing({ target: clients.telegramUserId })
      .returning();
    // Ссылка выдаётся только заведённому здесь: у приходившего в Mini
    // App она уже есть, и вторая «основная» сбила бы ему статистику по
    // кодам.
    if (inserted) {
      await insertPrimaryCode(tx, clientId);
    }

    const [row] = await tx
      .insert(ambassadors)
      .values({ clientId, title, note, createdBy: admin.staffId })
      .onConflictDoNothing({ target: ambassadors.clientId })
      .returning();
    if (!row) {
      throw new ConflictError('Этот человек уже в программе');
    }

    await recordSettingsChange(tx, admin.staffId, 'ambassador', String(clientId), {
      added: { title, note },
    });
  });

  return readOne(ctx.db, clientId);
}

/**
 * Снятие — отметкой, а не удалением строки: «этот входил и больше не
 * входит» и «этого никогда не было» — разные вещи, и первое нужно,
 * когда снятый придёт спросить, почему его не пускают. Начисленное ему
 * остаётся: работа сделана, а вход к деньгам отношения не имеет.
 */
export async function revokeAmbassador(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
): Promise<AmbassadorView> {
  return setRevoked(ctx, actor, clientId, new Date());
}

export async function restoreAmbassador(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
): Promise<AmbassadorView> {
  return setRevoked(ctx, actor, clientId, null);
}

async function setRevoked(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
  revokedAt: Date | null,
): Promise<AmbassadorView> {
  const admin = requireAdmin(actor);

  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ revokedAt: ambassadors.revokedAt })
      .from(ambassadors)
      .where(eq(ambassadors.clientId, clientId))
      .limit(1)
      .for('update');
    if (!row) {
      throw new NotFoundError('Амбассадор не найден');
    }
    if ((row.revokedAt === null) === (revokedAt === null)) {
      throw new ConflictError(revokedAt ? 'Отметка уже снята' : 'Отметка на месте');
    }

    await tx.update(ambassadors).set({ revokedAt }).where(eq(ambassadors.clientId, clientId));
    await recordSettingsChange(tx, admin.staffId, 'ambassador', String(clientId), {
      revoked: revokedAt !== null,
    });
  });

  return readOne(ctx.db, clientId);
}

/**
 * Вход в кабинет: есть ли отметка и не снята ли.
 *
 * Исполнителя здесь нет намеренно — его как раз и предстоит собрать по
 * ответу этой операции: до неё известна только подпись Telegram, а она
 * права не даёт. Дальше кабинет собирает обычного клиентского `Actor`,
 * того же, что собирает Mini App из подписи запуска.
 */
export async function signInAmbassador(
  ctx: CoreConfig,
  telegramUserId: bigint,
): Promise<AmbassadorSession> {
  const [row] = await ctx.db
    .select({
      clientId: ambassadors.clientId,
      title: ambassadors.title,
      firstSignedInAt: ambassadors.firstSignedInAt,
      revokedAt: ambassadors.revokedAt,
    })
    .from(ambassadors)
    .where(eq(ambassadors.clientId, telegramUserId))
    .limit(1);

  // Один отказ на «не заведён» и «снят»: кабинет отвечает обоим одним
  // экраном со ссылкой на поддержку, а разные слова сказали бы
  // подбирающему, чей идентификатор он угадал.
  if (!row || row.revokedAt !== null) {
    throw new ForbiddenError('Вас нет в программе амбассадоров');
  }

  if (row.firstSignedInAt === null) {
    // Условным изменением: два входа подряд иначе записали бы «первый»
    // дважды, и второй затёр бы настоящий.
    await ctx.db
      .update(ambassadors)
      .set({ firstSignedInAt: new Date() })
      .where(and(eq(ambassadors.clientId, telegramUserId), isNull(ambassadors.firstSignedInAt)));
  }

  return {
    clientId: row.clientId,
    title: row.title,
    firstSignedInAt: row.firstSignedInAt,
  };
}

export async function listAmbassadors(
  ctx: CoreConfig,
  actor: Actor,
  input: ListAmbassadorsInput = {},
): Promise<readonly AmbassadorView[]> {
  requireAdmin(actor);
  const query = input.query?.trim();
  if (!query) return read(ctx.db, undefined);

  // Подпись русская, а база сервиса собрана с локалью `C`: без явной
  // коллации «Пхукет» не находится на «пхукет» (`search.ts`).
  /*
   * Число сверх `bigint` в запрос не уходит: база ответила бы отказом
   * там, где человек просто ошибся при наборе, а пустой список — это и
   * есть честный ответ «такого нет».
   */
  const digits = parseTelegramUserId(query);
  return read(
    ctx.db,
    or(
      cyrillicLike(ambassadors.title, likePattern(query)),
      ...(digits === null ? [] : [eq(ambassadors.clientId, digits)]),
    ),
  );
}

async function readOne(db: Executor, clientId: bigint): Promise<AmbassadorView> {
  const [row] = await read(db, eq(ambassadors.clientId, clientId));
  if (!row) {
    throw new NotFoundError('Амбассадор не найден');
  }
  return row;
}

/**
 * Строки списка со счётом приведённых и начисленного.
 *
 * Приведённые считаются по тем же линиям, что оплачивает программа:
 * показать шестую линию там, где платят за три, значило бы обещать
 * деньги за то, за что их не платят.
 */
async function read(db: Executor, filter: SQL | undefined): Promise<readonly AmbassadorView[]> {
  const program = await readReferralProgram(db);

  const rows = await db
    .select({
      clientId: ambassadors.clientId,
      title: ambassadors.title,
      note: ambassadors.note,
      createdBy: ambassadors.createdBy,
      createdByName: staff.displayName,
      createdAt: ambassadors.createdAt,
      revokedAt: ambassadors.revokedAt,
      signedInAt: ambassadors.firstSignedInAt,
      username: clients.username,
      accrued: sql<
        string | null
      >`(select sum(${bonusTransactions.amount}) from ${bonusTransactions} where ${bonusTransactions.clientId} = ${ambassadors.clientId} and ${bonusTransactions.kind} = 'accrual')`,
    })
    .from(ambassadors)
    .innerJoin(staff, eq(staff.id, ambassadors.createdBy))
    .innerJoin(clients, eq(clients.telegramUserId, ambassadors.clientId))
    .where(filter)
    .orderBy(desc(ambassadors.createdAt), asc(ambassadors.clientId));

  if (rows.length === 0) return [];

  const lines = await db
    .select({ referrerId: referrals.referrerId, line: referrals.line, n: count() })
    .from(referrals)
    .innerJoin(ambassadors, eq(ambassadors.clientId, referrals.referrerId))
    .where(filter)
    .groupBy(referrals.referrerId, referrals.line);

  return rows.map((row) => ({
    clientId: row.clientId,
    title: row.title,
    note: row.note,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    signedInAt: row.signedInAt,
    username: row.username,
    referredByLine: countsByLine(
      lines.filter((one) => one.referrerId === row.clientId),
      program.depth,
    ),
    accrued: Money.toAmount(row.accrued ?? '0'),
  }));
}

function countsByLine(
  rows: readonly { line: number; n: number }[],
  depth: number,
): readonly { line: ReferralLine; count: number }[] {
  const byLine: { line: ReferralLine; count: number }[] = [];
  for (let line = 1; line <= depth; line += 1) {
    if (!isReferralLine(line)) continue;
    byLine.push({ line, count: rows.find((row) => row.line === line)?.n ?? 0 });
  }
  return byLine;
}
