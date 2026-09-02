import { and, count, eq, gte, lt, sql, sum } from 'drizzle-orm';
import { exchangeRequests } from '@nemo/db';
import {
  Money,
  exchangeRequestStatuses,
  type Amount,
  type ExchangeRequestStatus,
} from '@nemo/types';
import { requireAdmin, requireStaff, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { InvalidInputError } from './errors.js';

/**
 * Сводка по заявкам за период.
 *
 * Заявки считаются по дате подачи: в период попадают поданные в его
 * границах, и конверсия — доля исполненных среди них. Деньги считаются
 * по дате исполнения: оборот и доход за период — это то, что сервис
 * получил в этих днях, независимо от того, когда заявку подали.
 *
 * Валюты не суммируются между собой никогда: исторического курса у
 * сервиса нет, и приведённое к одной валюте число читалось бы как
 * факт. Оборот в рублях и оборот в USDT — два числа рядом.
 *
 * Границы периода — полуинтервал `[from, to)`: сутки «сегодня» — это с
 * полуночи до следующей полуночи, не включая её.
 */

export interface AnalyticsPeriod {
  readonly from: Date;
  readonly to: Date;
}

export interface MoneyByCurrency {
  readonly code: string;
  readonly amount: Amount;
  /** Сколько заявок дали эту сумму — для среднего чека. */
  readonly count: number;
}

/** Счётчики без денег: доступны любому сотруднику, стоят на обзоре. */
export interface ExchangeCounts {
  /** Подано в период. */
  readonly submitted: number;
  /** Исполнено в период — по дате исполнения. */
  readonly completed: number;
  /** Отменено в период — по дате отмены. */
  readonly cancelled: number;
  /** Из поданных в период — сколько сейчас в работе. */
  readonly open: number;
}

export interface ExchangeSummary extends ExchangeCounts {
  /** Отдано клиентами по исполненным в период — по валюте отдачи. */
  readonly turnover: readonly MoneyByCurrency[];
  /** Доход сервиса по исполненным в период — по валюте дохода. */
  readonly income: readonly MoneyByCurrency[];
  /** Исполненных среди поданных в период, 0..1; без поданных — null. */
  readonly conversion: number | null;
  /** От подачи до исполнения, минуты, по исполненным в период. */
  readonly averageMinutesToComplete: number | null;
  /** Поданные в период — по текущему состоянию. */
  readonly funnel: readonly { readonly status: ExchangeRequestStatus; readonly count: number }[];
}

export interface ExchangeAnalytics {
  readonly period: AnalyticsPeriod;
  readonly current: ExchangeSummary;
  /** Такой же по длине период прямо перед выбранным. */
  readonly previous: ExchangeSummary;
}

function requirePeriod(period: AnalyticsPeriod): AnalyticsPeriod {
  if (!(period.from < period.to)) {
    throw new InvalidInputError('Начало периода должно быть раньше конца');
  }
  return period;
}

/** Период той же длины, заканчивающийся там, где начинается этот. */
export function previousPeriod(period: AnalyticsPeriod): AnalyticsPeriod {
  const length = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - length), to: period.from };
}

async function countsFor(ctx: CoreConfig, period: AnalyticsPeriod): Promise<ExchangeCounts> {
  const submittedIn = and(
    gte(exchangeRequests.createdAt, period.from),
    lt(exchangeRequests.createdAt, period.to),
  );
  const [submitted, completed, cancelled, open] = await Promise.all([
    ctx.db.select({ n: count() }).from(exchangeRequests).where(submittedIn),
    ctx.db
      .select({ n: count() })
      .from(exchangeRequests)
      .where(
        and(
          eq(exchangeRequests.status, 'completed'),
          gte(exchangeRequests.completedAt, period.from),
          lt(exchangeRequests.completedAt, period.to),
        ),
      ),
    // Отмена — последнее, что случается с заявкой: её время — `updated_at`.
    ctx.db
      .select({ n: count() })
      .from(exchangeRequests)
      .where(
        and(
          eq(exchangeRequests.status, 'cancelled'),
          gte(exchangeRequests.updatedAt, period.from),
          lt(exchangeRequests.updatedAt, period.to),
        ),
      ),
    ctx.db
      .select({ n: count() })
      .from(exchangeRequests)
      .where(and(submittedIn, sql`${exchangeRequests.status} not in ('completed', 'cancelled')`)),
  ]);
  return {
    submitted: submitted[0]?.n ?? 0,
    completed: completed[0]?.n ?? 0,
    cancelled: cancelled[0]?.n ?? 0,
    open: open[0]?.n ?? 0,
  };
}

async function summaryFor(ctx: CoreConfig, period: AnalyticsPeriod): Promise<ExchangeSummary> {
  const submittedIn = and(
    gte(exchangeRequests.createdAt, period.from),
    lt(exchangeRequests.createdAt, period.to),
  );
  const completedIn = and(
    eq(exchangeRequests.status, 'completed'),
    gte(exchangeRequests.completedAt, period.from),
    lt(exchangeRequests.completedAt, period.to),
  );

  const [counts, turnover, income, timing, completedOfSubmitted, funnel] = await Promise.all([
    countsFor(ctx, period),
    ctx.db
      .select({
        code: exchangeRequests.fromCode,
        amount: sum(exchangeRequests.fromAmount),
        count: count(),
      })
      .from(exchangeRequests)
      .where(completedIn)
      .groupBy(exchangeRequests.fromCode),
    ctx.db
      .select({
        code: exchangeRequests.serviceIncomeCode,
        amount: sum(exchangeRequests.serviceIncome),
        count: count(),
      })
      .from(exchangeRequests)
      .where(completedIn)
      .groupBy(exchangeRequests.serviceIncomeCode),
    ctx.db
      .select({
        minutes: sql<
          string | null
        >`avg(extract(epoch from (${exchangeRequests.completedAt} - ${exchangeRequests.createdAt})) / 60)`,
      })
      .from(exchangeRequests)
      .where(completedIn),
    ctx.db
      .select({ n: count() })
      .from(exchangeRequests)
      .where(and(submittedIn, eq(exchangeRequests.status, 'completed'))),
    ctx.db
      .select({ status: exchangeRequests.status, count: count() })
      .from(exchangeRequests)
      .where(submittedIn)
      .groupBy(exchangeRequests.status),
  ]);

  const byStatus = new Map(funnel.map((row) => [row.status, row.count]));
  const minutes = timing[0]?.minutes;
  const completedCount = completedOfSubmitted[0]?.n ?? 0;

  return {
    ...counts,
    turnover: turnover
      .map((row) => ({
        code: row.code,
        amount: Money.toAmount(row.amount ?? '0'),
        count: row.count,
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    income: income
      .filter((row): row is typeof row & { code: string } => row.code !== null)
      .map((row) => ({
        code: row.code,
        amount: Money.toAmount(row.amount ?? '0'),
        count: row.count,
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    conversion: counts.submitted === 0 ? null : completedCount / counts.submitted,
    averageMinutesToComplete: minutes === null || minutes === undefined ? null : Number(minutes),
    // Все состояния, и нулевые тоже: воронка со «случайно пропавшей»
    // ступенью читалась бы как воронка без отмен.
    funnel: exchangeRequestStatuses.map((status) => ({
      status,
      count: byStatus.get(status) ?? 0,
    })),
  };
}

/** Счётчики за период — любому сотруднику. Денег здесь нет. */
export async function countExchangeRequestsFor(
  ctx: CoreConfig,
  actor: Actor,
  period: AnalyticsPeriod,
): Promise<ExchangeCounts> {
  requireStaff(actor);
  return countsFor(ctx, requirePeriod(period));
}

/**
 * Сводка с деньгами и сравнением — администратору. Доход сервиса —
 * экономика, которую сейчас видит только он.
 */
export async function summarizeExchangeRequests(
  ctx: CoreConfig,
  actor: Actor,
  period: AnalyticsPeriod,
): Promise<ExchangeAnalytics> {
  requireAdmin(actor);
  const current = requirePeriod(period);
  const [now, before] = await Promise.all([
    summaryFor(ctx, current),
    summaryFor(ctx, previousPeriod(current)),
  ]);
  return { period: current, current: now, previous: before };
}
