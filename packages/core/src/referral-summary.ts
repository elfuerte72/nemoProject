import { and, count, desc, eq, gte, inArray, lt, sql, sum } from 'drizzle-orm';
import { bonusTransactions, clients, referrals, withdrawalRequests } from '@nemo/db';
import { Money, isWithdrawalOpen, withdrawalRequestStatuses, type Amount } from '@nemo/types';
import { requireAdmin, type Actor } from './actor.js';
import type { AnalyticsPeriod } from './analytics.js';
import type { CoreConfig } from './context.js';
import { InvalidInputError } from './errors.js';

/**
 * Реферальная сводка за период — администратору.
 *
 * Ставки лежат в настройках, начисления — на счетах клиентов, открытые
 * выводы — в очереди. Ответить «сколько мы отдали рефералам в августе»
 * было негде; здесь это одно число на линию.
 *
 * Начисление считается в тот момент, когда оно записано, — то есть в
 * период исполнения заявки, а не её подачи: баллы появляются при
 * исполнении (docs/adr/0003). Ставка в строке начисления — та, что была
 * тогда: смена ставок прошлое не переписывает.
 */

export interface ReferralLineTotal {
  readonly line: 1 | 2;
  readonly amount: Amount;
  readonly count: number;
}

export interface ReferralTopClient {
  readonly telegramUserId: bigint;
  readonly username: string | null;
  readonly accrued: Amount;
  readonly accruals: number;
}

export interface ReferralSummary {
  readonly period: AnalyticsPeriod;
  /** Начислено за период по линиям. */
  readonly accrued: readonly ReferralLineTotal[];
  /** Выплачено за период — списано по выплаченным заявкам. */
  readonly paid: Amount;
  /** Ждёт выплаты сейчас — сумма открытых заявок на вывод. */
  readonly pending: Amount;
  /** Клиентов, у которых есть хотя бы один приведённый. */
  readonly referrers: number;
  /** Кому начислили больше всех за период. */
  readonly top: readonly ReferralTopClient[];
}

const TOP_LIMIT = 20;
const OPEN_WITHDRAWAL_STATUSES = withdrawalRequestStatuses.filter(isWithdrawalOpen);

export async function summarizeReferrals(
  ctx: CoreConfig,
  actor: Actor,
  period: AnalyticsPeriod,
): Promise<ReferralSummary> {
  requireAdmin(actor);
  if (!(period.from < period.to)) {
    throw new InvalidInputError('Начало периода должно быть раньше конца');
  }
  const inPeriod = and(
    gte(bonusTransactions.createdAt, period.from),
    lt(bonusTransactions.createdAt, period.to),
  );

  const [byLine, paid, pending, referrers, top] = await Promise.all([
    ctx.db
      .select({ line: bonusTransactions.line, amount: sum(bonusTransactions.amount), n: count() })
      .from(bonusTransactions)
      .where(and(eq(bonusTransactions.kind, 'accrual'), inPeriod))
      .groupBy(bonusTransactions.line),
    // Списание хранится отрицательным: выплачено — это минус сумма.
    ctx.db
      .select({ amount: sum(bonusTransactions.amount) })
      .from(bonusTransactions)
      .where(and(eq(bonusTransactions.kind, 'withdrawal'), inPeriod)),
    ctx.db
      .select({ amount: sum(withdrawalRequests.amount) })
      .from(withdrawalRequests)
      .where(inArray(withdrawalRequests.status, OPEN_WITHDRAWAL_STATUSES)),
    ctx.db
      .select({ n: sql<number>`count(distinct ${referrals.referrerId})::int` })
      .from(referrals),
    ctx.db
      .select({
        telegramUserId: bonusTransactions.clientId,
        username: clients.username,
        accrued: sum(bonusTransactions.amount),
        n: count(),
      })
      .from(bonusTransactions)
      .innerJoin(clients, eq(clients.telegramUserId, bonusTransactions.clientId))
      .where(and(eq(bonusTransactions.kind, 'accrual'), inPeriod))
      .groupBy(bonusTransactions.clientId, clients.username)
      .orderBy(desc(sum(bonusTransactions.amount)))
      .limit(TOP_LIMIT),
  ]);

  const lineTotal = (line: 1 | 2): ReferralLineTotal => {
    const row = byLine.find((one) => one.line === line);
    return { line, amount: Money.toAmount(row?.amount ?? '0'), count: row?.n ?? 0 };
  };
  const paidAmount = Money.toAmount(paid[0]?.amount ?? '0');

  return {
    period,
    accrued: [lineTotal(1), lineTotal(2)],
    paid: Money.isNegative(paidAmount) ? Money.subtract(Money.ZERO, paidAmount) : paidAmount,
    pending: Money.toAmount(pending[0]?.amount ?? '0'),
    referrers: referrers[0]?.n ?? 0,
    top: top.map((row) => ({
      telegramUserId: row.telegramUserId,
      username: row.username,
      accrued: Money.toAmount(row.accrued ?? '0'),
      accruals: row.n,
    })),
  };
}
