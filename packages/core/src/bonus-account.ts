import { and, count, desc, eq, sql } from 'drizzle-orm';
import { bonusTransactions, clients, referrals } from '@nemo/db';
import { Money, type Amount, type BonusTransactionKind, type ReferralLine } from '@nemo/types';
import { requireClient, type Actor } from './actor.js';
import { CLIENT_HISTORY_LIMIT } from './client-history.js';
import type { CoreConfig, Executor } from './context.js';
import { NotFoundError } from './errors.js';
import { readServiceSettings } from './settings.js';

/**
 * Реферальный кабинет клиента: сколько заработал, скольких привёл и за
 * что именно начислено.
 *
 * Баланс — сумма движений, а не отдельно хранимое число. Остаток,
 * который можно рассинхронизировать с историей, рано или поздно с ней
 * расходится, и тогда непонятно, какому из двух чисел верить.
 *
 * Про самих рефералов клиент видит только количество. Ни имени, ни
 * username, ни идентификатора: реферальная программа не повод раскрывать
 * одному клиенту, кто такой другой.
 */

export interface BonusTransactionView {
  readonly id: string;
  readonly kind: BonusTransactionKind;
  readonly amount: Amount;
  /** Линия, по которой начислено. У списаний и правок её нет. */
  readonly line: ReferralLine | null;
  /** Ставка линии на момент начисления, в базисных пунктах. */
  readonly rateBps: number | null;
  /** Заявка на обмен, за которую начислено. */
  readonly exchangeRequestId: string | null;
  readonly comment: string | null;
  readonly createdAt: Date;
}

export interface BonusAccountView {
  readonly balance: Amount;
  /**
   * Сколько начислено за всё время. Баланс — это остаток, и выведший
   * половину заработанного видит в нём половину; на вопрос «сколько мне
   * принесла рефералка» отвечает только это число.
   *
   * Считаются одни начисления: ручная правка администратора меняет
   * баланс, но заработком реферальной программы не является.
   */
  readonly earned: Amount;
  /** Полезная нагрузка реферальной ссылки. Саму ссылку собирает приложение. */
  readonly referralCode: string;
  readonly line1Count: number;
  readonly line2Count: number;
  /**
   * Ставки линий в базисных пунктах — те же, по которым начисляет ядро.
   *
   * Клиенту их называют: реферальная программа, условий которой не
   * видно, не работает — звать знакомых, не зная, сколько за это
   * платят, никто не станет. Приложение переводит их в проценты, как это
   * делает и панель администратора.
   *
   * Отдаются текущие, а не те, по которым начислено: ставка каждого
   * начисления сохранена в самом движении, и прошлое от смены настроек
   * не меняется.
   */
  readonly line1Bps: number;
  readonly line2Bps: number;
  readonly history: readonly BonusTransactionView[];
}

type BonusTransactionRow = typeof bonusTransactions.$inferSelect;

function toView(row: BonusTransactionRow): BonusTransactionView {
  return {
    id: row.id,
    kind: row.kind,
    amount: Money.toAmount(row.amount),
    line: row.line === 1 || row.line === 2 ? row.line : null,
    rateBps: row.rateBps,
    exchangeRequestId: row.exchangeRequestId,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

/**
 * Бонусный баланс клиента.
 *
 * Считается запросом к базе, а не сложением выгруженных строк: история
 * растёт, а баланс нужен и там, где вся она ни к чему — например перед
 * заявкой на вывод.
 */
export async function bonusBalance(
  executor: Executor,
  clientId: bigint,
): Promise<Amount> {
  const [row] = await executor
    .select({ total: sql<string | null>`sum(${bonusTransactions.amount})` })
    .from(bonusTransactions)
    .where(eq(bonusTransactions.clientId, clientId));

  // Пусто у клиента без движений: ни одного начисления ещё не было.
  return row?.total === null || row?.total === undefined
    ? Money.ZERO
    : Money.toAmount(row.total);
}

/**
 * Сколько клиенту начислено за всё время.
 *
 * Считается запросом, а не сложением выгруженной истории: история
 * ограничена потолком, и сумма по её видимому куску занижала бы
 * заработанное ровно у тех, кто заработал больше всех.
 */
async function bonusEarned(executor: Executor, clientId: bigint): Promise<Amount> {
  const [row] = await executor
    .select({ total: sql<string | null>`sum(${bonusTransactions.amount})` })
    .from(bonusTransactions)
    .where(
      and(eq(bonusTransactions.clientId, clientId), eq(bonusTransactions.kind, 'accrual')),
    );

  return row?.total === null || row?.total === undefined ? Money.ZERO : Money.toAmount(row.total);
}

async function countReferrals(
  executor: Executor,
  clientId: bigint,
  line: ReferralLine,
): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(referrals)
    .where(and(eq(referrals.referrerId, clientId), eq(referrals.line, line)));
  return row?.value ?? 0;
}

/**
 * Движения по баллам сами по себе — без остатка, сети и ссылки.
 *
 * Кабинету они нужны вместе со всем этим, ленте истории — отдельно и
 * рядом с заявками. Запрос один и тот же, и повторять его на месте
 * значило бы завести вторую правду о том, в каком порядке читается
 * история баллов.
 */
export async function listBonusTransactions(
  executor: Executor,
  clientId: bigint,
): Promise<readonly BonusTransactionView[]> {
  const rows = await executor
    .select()
    .from(bonusTransactions)
    .where(eq(bonusTransactions.clientId, clientId))
    .orderBy(desc(bonusTransactions.createdAt), desc(bonusTransactions.id))
    .limit(CLIENT_HISTORY_LIMIT);
  return rows.map(toView);
}

export async function getBonusAccount(
  ctx: CoreConfig,
  actor: Actor,
): Promise<BonusAccountView> {
  const clientId = requireClient(actor);

  const [client] = await ctx.db
    .select({ referralCode: clients.referralCode })
    .from(clients)
    .where(eq(clients.telegramUserId, clientId))
    .limit(1);
  if (!client) {
    throw new NotFoundError('Клиент не найден');
  }

  const [balance, earned, line1Count, line2Count, history, settings] = await Promise.all([
    bonusBalance(ctx.db, clientId),
    bonusEarned(ctx.db, clientId),
    countReferrals(ctx.db, clientId, 1),
    countReferrals(ctx.db, clientId, 2),
    listBonusTransactions(ctx.db, clientId),
    readServiceSettings(ctx.db),
  ]);

  return {
    balance,
    earned,
    referralCode: client.referralCode,
    line1Count,
    line2Count,
    line1Bps: settings.referralLine1Bps,
    line2Bps: settings.referralLine2Bps,
    history,
  };
}
