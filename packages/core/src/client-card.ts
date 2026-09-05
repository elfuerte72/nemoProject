import { and, count, desc, eq, max, sum, sql } from 'drizzle-orm';
import { bonusTransactions, clientMessages, clients, exchangeRequests, referrals } from '@nemo/db';
import { Money, type Amount } from '@nemo/types';
import { requireStaff, type Actor } from './actor.js';
import type { MoneyByCurrency } from './analytics.js';
import { REGULAR_CLIENT_COMPLETED } from './clients-directory.js';
import type { CoreConfig } from './context.js';
import { NotFoundError } from './errors.js';

/**
 * Клиент глазами сотрудника: с кем он имеет дело.
 *
 * Отдельно от `ClientView`: там профиль самого клиента, а здесь то, что
 * нужно менеджеру рядом с работой — по чему окликнуть, давно ли в
 * сервисе, сколько раз с ним работали и скольких он привёл. Ник нужен
 * для ссылки в Telegram: по числовому идентификатору аккаунт не
 * открывается, и без ника окликнуть человека можно только через того же
 * бота.
 *
 * Статистика едет той же операцией, а не отдельной: карточка стоит на
 * трёх экранах, и второй круг по сети за числами платился бы на каждом
 * открытии разговора. Числа те же, что в списке клиентов, и порог
 * «постоянного» — та же константа: два счёта одних и тех же заявок
 * разошлись бы при первой правке.
 */

export interface ClientStats {
  /** Исполненных заявок — «сколько раз с ним работали». */
  readonly completed: number;
  /** Незакрытых сейчас. */
  readonly open: number;
  readonly cancelled: number;
  /** Когда подал последнюю заявку. Пусто — не подавал ни одной. */
  readonly lastRequestAt: Date | null;
  /**
   * Оборот по исполненным — по валютам раздельно и по отданной стороне.
   * Валюты не складываются: исторического курса у сервиса нет.
   */
  readonly turnover: readonly MoneyByCurrency[];
  /** От трёх исполненных — подсказка «с ним уже работали». */
  readonly regular: boolean;
  /** Последнее сообщение в переписке — от клиента, ответа ещё нет. */
  readonly waiting: boolean;
  /** Скольких привёл сам. */
  readonly invitedLine1: number;
  /** Скольких привели приведённые им. */
  readonly invitedLine2: number;
  /**
   * Начислено реферальной программой за всё время. Не баланс: выведший
   * половину заработанного видел бы в балансе половину.
   */
  readonly referralEarned: Amount;
}

export interface ClientCardView {
  readonly telegramUserId: bigint;
  readonly username: string | null;
  readonly createdAt: Date;
  readonly referralCode: string;
  /** Кто привёл. Пусто — пришёл сам. */
  readonly referrerId: bigint | null;
  readonly referrerUsername: string | null;
  /** Согласие на рассылку: молчащему писать о курсах нельзя. */
  readonly marketingConsent: boolean;
  /**
   * Разговор ведёт человек: помощник в нём молчит.
   *
   * Здесь, а не отдельной операцией: строка клиента для карточки уже
   * прочитана, а второй запрос ради одного признака платится на каждом
   * открытии разговора.
   */
  readonly handedToHuman: boolean;
  readonly stats: ClientStats;
}

export async function getClientCard(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
): Promise<ClientCardView> {
  requireStaff(actor);

  const [row] = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.telegramUserId, clientId))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Клиент не найден');
  }

  const [referrer, counts, turnover, invited, earned, lastMessage] = await Promise.all([
    // Пригласивший — тем же заходом, а не отдельной операцией: без ника
    // строка «привёл 418822013» ничего менеджеру не говорит.
    row.referrerId
      ? ctx.db
          .select({ username: clients.username })
          .from(clients)
          .where(eq(clients.telegramUserId, row.referrerId))
          .limit(1)
      : Promise.resolve([]),
    ctx.db
      .select({
        completed: sql<number>`count(*) filter (where ${exchangeRequests.status} = 'completed')::int`,
        cancelled: sql<number>`count(*) filter (where ${exchangeRequests.status} = 'cancelled')::int`,
        open: sql<number>`count(*) filter (where ${exchangeRequests.status} not in ('completed', 'cancelled'))::int`,
        lastRequestAt: max(exchangeRequests.createdAt),
      })
      .from(exchangeRequests)
      .where(eq(exchangeRequests.clientId, clientId)),
    ctx.db
      .select({ code: exchangeRequests.fromCode, amount: sum(exchangeRequests.fromAmount), n: count() })
      .from(exchangeRequests)
      .where(and(eq(exchangeRequests.clientId, clientId), eq(exchangeRequests.status, 'completed')))
      .groupBy(exchangeRequests.fromCode),
    ctx.db
      .select({ line: referrals.line, n: count() })
      .from(referrals)
      .where(eq(referrals.referrerId, clientId))
      .groupBy(referrals.line),
    ctx.db
      .select({ amount: sum(bonusTransactions.amount) })
      .from(bonusTransactions)
      .where(
        and(eq(bonusTransactions.clientId, clientId), eq(bonusTransactions.kind, 'accrual')),
      ),
    // Ждёт ли ответа — по последнему сообщению, а не по счёту входящих:
    // отвеченный вчера клиент, написавший десять раз, ничего не ждёт.
    // Порядок по `seq`: два сообщения одной миллисекунды время не разводит.
    ctx.db
      .select({ direction: clientMessages.direction })
      .from(clientMessages)
      .where(eq(clientMessages.clientId, clientId))
      .orderBy(desc(clientMessages.seq))
      .limit(1),
  ]);

  const completed = counts[0]?.completed ?? 0;
  const invitedOn = (line: 1 | 2): number =>
    invited.find((one) => one.line === line)?.n ?? 0;

  return {
    telegramUserId: row.telegramUserId,
    username: row.username,
    createdAt: row.createdAt,
    referralCode: row.referralCode,
    referrerId: row.referrerId,
    referrerUsername: referrer[0]?.username ?? null,
    marketingConsent: row.marketingConsent,
    handedToHuman: row.handedToHumanAt !== null,
    stats: {
      completed,
      open: counts[0]?.open ?? 0,
      cancelled: counts[0]?.cancelled ?? 0,
      lastRequestAt: counts[0]?.lastRequestAt ?? null,
      turnover: turnover
        .map((line) => ({
          code: line.code,
          amount: Money.toAmount(line.amount ?? '0'),
          count: line.n,
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      regular: completed >= REGULAR_CLIENT_COMPLETED,
      waiting: lastMessage[0]?.direction === 'incoming',
      invitedLine1: invitedOn(1),
      invitedLine2: invitedOn(2),
      referralEarned: Money.toAmount(earned[0]?.amount ?? '0'),
    },
  };
}
