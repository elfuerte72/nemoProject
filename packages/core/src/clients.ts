import { eq } from 'drizzle-orm';
import { clients, referrals } from '@nemo/db';
import type { CoreContext, Executor } from './context.js';
import { NotFoundError } from './errors.js';
import type { Notification } from './notifications.js';
import { generateReferralCode } from './referral-code.js';

/**
 * Регистрация клиента и реферальная привязка.
 *
 * Регистрации как отдельного шага нет: человек открывает приложение из
 * бота, и первый же запуск делает его клиентом. Идентификатор берётся
 * из подписанных данных запуска и больше ниоткуда — проверку подписи
 * выполняет адаптер до вызова операции.
 */

export interface ClientView {
  readonly telegramUserId: bigint;
  readonly username: string | null;
  readonly referralCode: string;
  readonly referrerId: bigint | null;
  readonly marketingConsent: boolean;
  readonly createdAt: Date;
}

export interface RegisterClientInput {
  readonly telegramUserId: bigint;
  readonly username?: string | undefined;
  /** Полезная нагрузка реферальной ссылки, если запуск был по ней. */
  readonly referralCode?: string | undefined;
}

export interface RegisterClientResult {
  readonly client: ClientView;
  /** Ложь при повторном запуске: клиент уже был. */
  readonly created: boolean;
  readonly notifications: readonly Notification[];
}

type ClientRow = typeof clients.$inferSelect;

function toView(row: ClientRow): ClientView {
  return {
    telegramUserId: row.telegramUserId,
    username: row.username,
    referralCode: row.referralCode,
    referrerId: row.referrerId,
    marketingConsent: row.marketingConsent,
    createdAt: row.createdAt,
  };
}

async function findByTelegramUserId(
  executor: Executor,
  telegramUserId: bigint,
): Promise<ClientRow | undefined> {
  const [row] = await executor
    .select()
    .from(clients)
    .where(eq(clients.telegramUserId, telegramUserId))
    .limit(1);
  return row;
}

export async function registerClient(
  ctx: CoreContext,
  input: RegisterClientInput,
): Promise<RegisterClientResult> {
  return ctx.db.transaction(async (tx) => {
    const referrer = input.referralCode
      ? await findReferrer(tx, input.referralCode, input.telegramUserId)
      : undefined;

    // `do nothing` вместо проверки «есть ли уже такой»: между проверкой
    // и вставкой параллельный запуск успел бы создать ту же строку.
    // Пустой результат означает «клиент уже был», а не отказ.
    const [inserted] = await tx
      .insert(clients)
      .values({
        telegramUserId: input.telegramUserId,
        username: input.username ?? null,
        referralCode: generateReferralCode(),
        referrerId: referrer?.telegramUserId ?? null,
      })
      .onConflictDoNothing({ target: clients.telegramUserId })
      .returning();

    if (!inserted) {
      const existing = await findByTelegramUserId(tx, input.telegramUserId);
      if (!existing) {
        throw new NotFoundError('Клиент исчез между вставкой и чтением');
      }
      // Привязка не пересматривается: реферер закрепляется однажды и
      // навсегда. Username, наоборот, в Telegram меняется, и хранить
      // устаревший смысла нет.
      const refreshed =
        input.username !== undefined && input.username !== existing.username
          ? await updateUsername(tx, existing.telegramUserId, input.username)
          : existing;
      return { client: toView(refreshed), created: false, notifications: [] };
    }

    const notifications: Notification[] = [];
    if (referrer) {
      await tx.insert(referrals).values({
        referrerId: referrer.telegramUserId,
        referralId: inserted.telegramUserId,
        line: 1,
      });
      notifications.push({ kind: 'referral-joined', to: referrer.telegramUserId, line: 1 });

      // Вторая линия разворачивается сразу, а не вычисляется обходом
      // при начислении: обход зависел бы от того, что связи первой
      // линии никто не менял, а начисление должно опираться на факт,
      // зафиксированный в момент регистрации.
      if (referrer.referrerId !== null) {
        await tx.insert(referrals).values({
          referrerId: referrer.referrerId,
          referralId: inserted.telegramUserId,
          line: 2,
        });
        notifications.push({ kind: 'referral-joined', to: referrer.referrerId, line: 2 });
      }
    }

    return { client: toView(inserted), created: true, notifications };
  });
}

/**
 * Кто пригласил. Ссылка на самого себя не ошибка запроса, а обычное
 * дело: клиент открывает собственную ссылку, чтобы посмотреть, что
 * увидит знакомый. Привязка при этом просто не возникает — то же, что
 * при неизвестном коде. Последний рубеж всё равно у базы:
 * `clients_no_self_referral` отвергнет такую строку, откуда бы она ни
 * пришла.
 */
async function findReferrer(
  executor: Executor,
  referralCode: string,
  registering: bigint,
): Promise<ClientRow | undefined> {
  const [row] = await executor
    .select()
    .from(clients)
    .where(eq(clients.referralCode, referralCode))
    .limit(1);
  return row?.telegramUserId === registering ? undefined : row;
}

async function updateUsername(
  executor: Executor,
  telegramUserId: bigint,
  username: string,
): Promise<ClientRow> {
  const [row] = await executor
    .update(clients)
    .set({ username })
    .where(eq(clients.telegramUserId, telegramUserId))
    .returning();
  if (!row) {
    throw new NotFoundError('Клиент не найден');
  }
  return row;
}

/** Профиль клиента. Читает только сам клиент — чужой профиль не отдаётся. */
export async function getClient(
  ctx: CoreContext,
  telegramUserId: bigint,
): Promise<ClientView> {
  const row = await findByTelegramUserId(ctx.db, telegramUserId);
  if (!row) {
    throw new NotFoundError('Клиент не найден');
  }
  return toView(row);
}
