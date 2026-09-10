import { eq, sql } from 'drizzle-orm';
import { clients, exchangeRequests, referrals } from '@nemo/db';
import { MAX_REFERRAL_DEPTH, isReferralLine } from '@nemo/types';
import { requireClient, requireStaff, type Actor } from './actor.js';
import { readReferralProgram } from './referral-program.js';
import type { CoreConfig, Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import type { Notification } from './notifications.js';
import { findActiveCode, insertPrimaryCode, primaryReferralCode } from './referral-codes.js';

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
  /**
   * Основной код — самая ранняя действующая ссылка клиента. Кодов у него
   * бывает несколько (`referral-codes.ts`); этот шлёт бот и лист
   * «Пригласить».
   */
  readonly referralCode: string;
  readonly referrerId: bigint | null;
  readonly marketingConsent: boolean;
  /**
   * Отвечал ли клиент на вопрос о рассылке. Ложь означает «спросить
   * снова», а не «отказался»: закрывший приложение до ответа иначе не
   * увидел бы вопроса больше никогда.
   */
  readonly marketingConsentAsked: boolean;
  readonly createdAt: Date;
}

export interface RegisterClientInput {
  readonly telegramUserId: bigint;
  readonly username?: string | undefined;
  /**
   * Код из ссылки, по которой открыли приложение, — ссылка или
   * промокод, без учёта регистра.
   */
  readonly referralCode?: string | undefined;
}

export interface RegisterClientResult {
  readonly client: ClientView;
  /** Ложь при повторном запуске: клиент уже был. */
  readonly created: boolean;
  readonly notifications: readonly Notification[];
}

type ClientRow = typeof clients.$inferSelect;

function toView(row: ClientRow, referralCode: string): ClientView {
  return {
    telegramUserId: row.telegramUserId,
    username: row.username,
    referralCode,
    referrerId: row.referrerId,
    marketingConsent: row.marketingConsent,
    marketingConsentAsked: row.marketingConsentAskedAt !== null,
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
  ctx: CoreConfig,
  input: RegisterClientInput,
): Promise<RegisterClientResult> {
  return ctx.db.transaction(async (tx) => {
    const via = await findReferrerByCode(tx, input.referralCode, input.telegramUserId);

    // `do nothing` вместо проверки «есть ли уже такой»: между проверкой
    // и вставкой параллельный запуск успел бы создать ту же строку.
    // Пустой результат означает «клиент уже был», а не отказ.
    const [inserted] = await tx
      .insert(clients)
      .values({
        telegramUserId: input.telegramUserId,
        username: input.username ?? null,
        referrerId: via?.referrer.telegramUserId ?? null,
        referredViaCodeId: via?.codeId ?? null,
      })
      .onConflictDoNothing({ target: clients.telegramUserId })
      .returning();

    if (!inserted) {
      const existing = await findByTelegramUserId(tx, input.telegramUserId);
      if (!existing) {
        throw new NotFoundError('Клиент исчез между вставкой и чтением');
      }
      // Привязка здесь не пересматривается: реферер закрепляется при
      // первом запуске, а позже — только промокодом и только пока клиент
      // чист (`bindReferrerByPromoCode`). Username, наоборот, в Telegram
      // меняется, и хранить устаревший смысла нет.
      const refreshed =
        input.username !== undefined && input.username !== existing.username
          ? await updateUsername(tx, existing.telegramUserId, input.username)
          : existing;
      const code = await primaryReferralCode(tx, existing.telegramUserId);
      return { client: toView(refreshed, code), created: false, notifications: [] };
    }

    const code = await insertPrimaryCode(tx, inserted.telegramUserId);
    const notifications = via ? await linkChain(tx, via.referrer, inserted.telegramUserId) : [];

    return { client: toView(inserted, code), created: true, notifications };
  });
}

interface ReferrerByCode {
  readonly referrer: ClientRow;
  readonly codeId: string;
}

/**
 * Кто пригласил — по действующему коду любого вида. Ссылка на самого
 * себя не ошибка запроса, а обычное дело: клиент открывает собственную
 * ссылку, чтобы посмотреть, что увидит знакомый. Привязка при этом
 * просто не возникает — то же, что при неизвестном или архивном коде.
 * Последний рубеж всё равно у базы: `clients_no_self_referral`
 * отвергнет такую строку, откуда бы она ни пришла.
 */
async function findReferrerByCode(
  executor: Executor,
  referralCode: string | undefined,
  registering: bigint,
): Promise<ReferrerByCode | undefined> {
  if (!referralCode) return undefined;
  const code = await findActiveCode(executor, referralCode);
  if (!code || code.clientId === registering) return undefined;
  const referrer = await findByTelegramUserId(executor, code.clientId);
  return referrer ? { referrer, codeId: code.id } : undefined;
}

/**
 * Цепочка предков до `MAX_REFERRAL_DEPTH` — строкой на каждого, с
 * линией. Разворачивается сразу, а не вычисляется обходом при
 * начислении: обход зависел бы от того, что связи никто не менял, а
 * начисление должно опираться на факт, зафиксированный в момент
 * привязки. Хранится глубже, чем платится: углубление программы позже
 * доходит и до старых цепочек (docs/adr/0021).
 */
async function linkChain(
  executor: Executor,
  referrer: ClientRow,
  referralId: bigint,
): Promise<Notification[]> {
  const notifications: Notification[] = [];
  // Сколько линий оплачивается сейчас: строка пишется до пятой всегда,
  // а сообщается только о той, за которую платят.
  const { depth } = await readReferralProgram(executor);
  let ancestor: ClientRow | undefined = referrer;
  for (let line = 1; ancestor && line <= MAX_REFERRAL_DEPTH; line += 1) {
    if (!isReferralLine(line)) break;
    await executor.insert(referrals).values({
      referrerId: ancestor.telegramUserId,
      referralId,
      line,
    });
    /*
     * «У вас новый реферал пятой линии» тому, кому за пятую линию не
     * начислят ни балла, — это обещание, которого сервис не давал: в
     * его собственном кабинете такой линии нет вовсе, и сверить
     * сообщение будет не с чем.
     */
    if (line <= depth) {
      notifications.push({ kind: 'referral-joined', to: ancestor.telegramUserId, line });
    }
    ancestor =
      ancestor.referrerId === null
        ? undefined
        : await findByTelegramUserId(executor, ancestor.referrerId);
  }
  return notifications;
}

/**
 * Что мешает клиенту ввести чужой промокод — словами, или `null`, когда
 * ничего. Одно правило на операцию привязки и на признак в счёте: экран
 * показывает поле по нему, а решает всё равно операция (docs/adr/0021).
 */
export async function promoBindingObstacle(
  executor: Executor,
  clientId: bigint,
): Promise<string | null> {
  const [row] = await executor
    .select({
      referrerId: clients.referrerId,
      requests: sql<number>`(select count(*) from ${exchangeRequests} where ${exchangeRequests.clientId} = ${clients.telegramUserId})::int`,
    })
    .from(clients)
    .where(eq(clients.telegramUserId, clientId))
    .limit(1);
  if (!row) return 'Клиент не найден';
  if (row.referrerId !== null) return 'Вас уже пригласили: кто привёл, не меняется';
  if (row.requests > 0) return 'Промокод вводят до первой заявки, а у вас она уже есть';
  return null;
}

/** Стоит ли `clientId` среди предков `descendant` — по `referrer_id` вверх до корня. */
async function isAncestor(executor: Executor, clientId: bigint, descendant: ClientRow): Promise<boolean> {
  let current: ClientRow | undefined = descendant;
  // Предел — страховка от кольца, которого быть не должно; цепочки в
  // сотню поколений у сервиса не бывает.
  for (let hops = 0; current && hops < 100; hops += 1) {
    if (current.referrerId === null) return false;
    if (current.referrerId === clientId) return true;
    current = await findByTelegramUserId(executor, current.referrerId);
  }
  return false;
}

/**
 * Привязать реферера промокодом после регистрации.
 *
 * Промокод по природе вводят руками, часто уже открыв приложение, — а
 * реферер закрепляется при первом запуске. Поэтому привязка разрешена
 * тому, у кого ещё нет ни реферера, ни заявок: клиент с заявками — уже
 * клиент сервиса, и приписывать его рефереру задним числом значило бы
 * платить за того, кого никто не приводил (docs/adr/0021).
 *
 * К своему рефералу привязаться нельзя: цепочка замкнулась бы в кольцо,
 * и предки считались бы по кругу.
 */
export async function bindReferrerByPromoCode(
  ctx: CoreConfig,
  actor: Actor,
  code: string,
): Promise<RegisterClientResult> {
  const clientId = requireClient(actor);
  return ctx.db.transaction(async (tx) => {
    // Строка под замком до проверки: подача заявки в ту же секунду иначе
    // прошла бы между счётом заявок и записью реферера.
    const [row] = await tx
      .select({ id: clients.telegramUserId })
      .from(clients)
      .where(eq(clients.telegramUserId, clientId))
      .limit(1)
      .for('update');
    if (!row) {
      throw new NotFoundError('Клиент не найден');
    }
    const obstacle = await promoBindingObstacle(tx, clientId);
    if (obstacle !== null) {
      throw new InvalidInputError(obstacle);
    }

    const found = await findActiveCode(tx, code);
    if (!found) {
      throw new NotFoundError('Код не найден: проверьте, так ли он написан');
    }
    if (found.clientId === clientId) {
      throw new InvalidInputError('Это ваш собственный код');
    }
    const referrer = await findByTelegramUserId(tx, found.clientId);
    if (!referrer) {
      throw new NotFoundError('Код не найден: проверьте, так ли он написан');
    }
    // Кольцо ищется по предкам владельца кода, а не по `referrals`: там
    // цепочка записана лишь до пятой линии, а потомок шестой замкнул
    // бы её так же.
    if (await isAncestor(tx, clientId, referrer)) {
      throw new InvalidInputError('Этот код принадлежит вашему рефералу');
    }

    const [updated] = await tx
      .update(clients)
      .set({ referrerId: referrer.telegramUserId, referredViaCodeId: found.id })
      .where(eq(clients.telegramUserId, clientId))
      .returning();
    const notifications = await linkChain(tx, referrer, clientId);
    const primary = await primaryReferralCode(tx, clientId);
    return { client: toView(updated!, primary), created: false, notifications };
  });
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

/**
 * Заведён ли такой клиент — вопрос сотрудника, а не самого клиента.
 *
 * Нужен там, где доставка идёт раньше записи: файл менеджера уходит в
 * Telegram, чтобы получить идентификатор, и только потом ложится в
 * ленту. Отправить его тому, кого в базе нет, значило бы послать файл
 * в чат, о котором у сервиса не останется ни строки.
 */
export async function clientExists(
  ctx: CoreConfig,
  actor: Actor,
  telegramUserId: bigint,
): Promise<boolean> {
  requireStaff(actor);
  const [row] = await ctx.db
    .select({ id: clients.telegramUserId })
    .from(clients)
    .where(eq(clients.telegramUserId, telegramUserId))
    .limit(1);
  return row !== undefined;
}

/**
 * Профиль самого клиента. Идентификатор берётся из `Actor`, а не из
 * аргумента: операция, которой можно передать чужой `telegram_user_id`,
 * рано или поздно его и получит.
 */
export async function getClient(ctx: CoreConfig, actor: Actor): Promise<ClientView> {
  const row = await findByTelegramUserId(ctx.db, requireClient(actor));
  if (!row) {
    throw new NotFoundError('Клиент не найден');
  }
  return toView(row, await primaryReferralCode(ctx.db, row.telegramUserId));
}
