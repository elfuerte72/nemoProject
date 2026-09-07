import { and, count, eq, gte, isNotNull, lt, or, sql, sum } from 'drizzle-orm';
import {
  apiRequestLog,
  exchangeRequests,
  merchants,
  webhookDeliveries,
  webhookEndpoints,
} from '@nemo/db';
import { Money } from '@nemo/types';
import { requireStaff, type Actor } from './actor.js';
import {
  cancelledWithin,
  completedWithin,
  DAY_MS,
  dayKey,
  localDayOf,
  minutesToComplete,
  previousPeriod,
  requireOffset,
  requirePeriod,
  stillOpen,
  submittedWithin,
  type AnalyticsPeriod,
  type MoneyByCurrency,
} from './analytics.js';
import type { CoreConfig } from './context.js';
import { NotFoundError } from './errors.js';

/**
 * Сводка мерчанта — по правилам аналитики (docs/adr/0013) и теми же
 * условиями (`submittedWithin`, `completedWithin`, `cancelledWithin`):
 * заявки по дате подачи, деньги по дате исполнения, сравнение с равным
 * периодом прямо перед выбранным, валюты не складываются.
 *
 * Читают её двое: сам мерчант в обзоре кабинета и сотрудник в его
 * карточке, — и числа у них одни: «у нас исполнено двенадцать» и «у
 * вас исполнено одиннадцать» — разговор, который лучше не начинать.
 * Своё у мерчанта — вызовы API и доставки вебхуков за период: по ним
 * видно, что интеграция жива, раньше, чем об этом спросят.
 *
 * Считается одним пакетом запросов: оба периода и «сегодня» — одним
 * проходом по заявкам с `count(*) filter (where …)`, оборот обоих
 * периодов одним `group by`, вызовы и доставки по запросу на источник.
 * Экран зовёт операцию один раз и помнит ответ до конца запроса.
 */

export interface MerchantPeriodSummary {
  /** Подано в период. */
  readonly submitted: number;
  /** Исполнено в период — по дате исполнения. */
  readonly completed: number;
  /** Отменено в период — по дате отмены. */
  readonly cancelled: number;
  /** Из поданных в период — сколько сейчас в работе. */
  readonly open: number;
  /** Отдано мерчантом по исполненным в период — по валюте отдачи. */
  readonly turnover: readonly MoneyByCurrency[];
  /** От подачи до исполнения, минуты, по исполненным в период. */
  readonly averageMinutesToComplete: number | null;
  /** Вызовов API за период и сколько из них отвергнуто. */
  readonly apiCalls: { readonly total: number; readonly failed: number };
  /** Доставок вебхуков, заведённых в период, и сколько не доставлено. */
  readonly webhookDeliveries: { readonly total: number; readonly failed: number };
}

export interface MerchantDay {
  /** День «2026-09-02» по местному времени того, кто смотрит. */
  readonly day: string;
  readonly submitted: number;
  readonly completed: number;
}

export interface MerchantStats {
  readonly period: AnalyticsPeriod;
  readonly current: MerchantPeriodSummary;
  /** Такой же по длине период прямо перед выбранным. */
  readonly previous: MerchantPeriodSummary;
  /** Сегодняшние сутки по часам того, кто смотрит — строкой над плитками. */
  readonly today: { readonly submitted: number; readonly completed: number; readonly cancelled: number };
  /** Подано и исполнено по дням за две недели до «сейчас», с нулями. */
  readonly byDay: readonly MerchantDay[];
}

export interface MerchantStatsOptions {
  /** Смещение часового пояса того, кто смотрит, минуты к востоку от UTC. */
  readonly offsetMinutes?: number | undefined;
  /** «Сейчас»: от него считаются «сегодня» и две недели столбиков. Не задано — часы сервера. */
  readonly now?: Date | undefined;
}

/** Исполнено с даты и оборот по валютам — строка списка мерчантов. */
export interface MerchantActivity {
  readonly completed: number;
  readonly turnover: readonly MoneyByCurrency[];
}

/** Сколько дней в столбиках обзора: две недели читаются одним взглядом. */
const BY_DAY_DAYS = 14;

/**
 * Кому можно читать сводку: мерчанту — свою, сотруднику — любую.
 *
 * Чужая для мерчанта — «не найдена», как чужая заявка: отличать одно от
 * другого значило бы подтверждать существование тому, кто перебирает.
 * Существование сверяется только для сотрудника: мерчант, который
 * спрашивает о себе, уже доказал его сессией.
 */
async function requireReadable(ctx: CoreConfig, actor: Actor, merchantId: string): Promise<void> {
  if (actor.type === 'merchant') {
    if (actor.merchantId !== merchantId) throw new NotFoundError('Мерчант не найден');
    return;
  }
  requireStaff(actor);
  const [row] = await ctx.db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!row) throw new NotFoundError('Мерчант не найден');
}

function toMoneyLines(
  rows: readonly { code: string; amount: string | null; count: number }[],
): MoneyByCurrency[] {
  return rows
    .map((row) => ({ code: row.code, amount: Money.toAmount(row.amount ?? '0'), count: row.count }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Счётчики одного периода в одном запросе — по столбцу на число. */
function countColumns(period: AnalyticsPeriod) {
  const submittedIn = submittedWithin(period);
  const completedIn = completedWithin(period);
  return {
    submitted: sql`count(*) filter (where ${submittedIn})`.mapWith(Number),
    open: sql`count(*) filter (where ${submittedIn} and ${stillOpen})`.mapWith(Number),
    completed: sql`count(*) filter (where ${completedIn})`.mapWith(Number),
    cancelled: sql`count(*) filter (where ${cancelledWithin(period)})`.mapWith(Number),
    minutes: sql<string | null>`${minutesToComplete} filter (where ${completedIn})`,
  };
}

interface Counted {
  readonly submitted: number;
  readonly open: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly minutes: string | null;
}

/** Местная полночь сегодняшнего дня — моментом UTC. */
function localMidnight(now: Date, offset: number): Date {
  const shifted = new Date(now.getTime() + offset * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offset * 60_000);
}

export async function summarizeMerchant(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
  period: AnalyticsPeriod,
  options: MerchantStatsOptions = {},
): Promise<MerchantStats> {
  await requireReadable(ctx, actor, merchantId);
  const current = requirePeriod(period);
  const previous = previousPeriod(current);
  const offset = requireOffset(options.offsetMinutes);
  const now = options.now ?? new Date();
  const todayStart = localMidnight(now, offset);
  const tomorrow = new Date(todayStart.getTime() + DAY_MS);
  const today = { from: todayStart, to: tomorrow };
  const window = { from: new Date(tomorrow.getTime() - BY_DAY_DAYS * DAY_MS), to: tomorrow };

  const mine = eq(exchangeRequests.merchantId, merchantId);
  // Типизированными операторами, как и условия по заявкам: сырой `sql`
  // с датой без колонки рядом драйвер отправляет строкой.
  const periodOf = (column: typeof apiRequestLog.at | typeof webhookDeliveries.createdAt, one: AnalyticsPeriod) =>
    and(gte(column, one.from), lt(column, one.to))!;
  const submittedDay = localDayOf(exchangeRequests.createdAt, offset);
  const completedDay = localDayOf(exchangeRequests.completedAt, offset);

  const [counts, turnover, calls, deliveries, submittedByDay, completedByDay] = await Promise.all([
    ctx.db
      .select({
        current: sql<Counted>`json_build_object('submitted', ${countColumns(current).submitted}, 'open', ${countColumns(current).open}, 'completed', ${countColumns(current).completed}, 'cancelled', ${countColumns(current).cancelled}, 'minutes', ${countColumns(current).minutes})`,
        previous: sql<Counted>`json_build_object('submitted', ${countColumns(previous).submitted}, 'open', ${countColumns(previous).open}, 'completed', ${countColumns(previous).completed}, 'cancelled', ${countColumns(previous).cancelled}, 'minutes', ${countColumns(previous).minutes})`,
        today: sql<Counted>`json_build_object('submitted', ${countColumns(today).submitted}, 'open', 0, 'completed', ${countColumns(today).completed}, 'cancelled', ${countColumns(today).cancelled}, 'minutes', null)`,
      })
      .from(exchangeRequests)
      .where(mine),
    /*
     * Оборот обоих периодов одной группировкой по валюте: суммы под
     * `filter`, а не `case when` в `group by` — выражение с параметрами
     * в `select` и в `group by` Postgres одинаковым не признаёт.
     */
    ctx.db
      .select({
        code: exchangeRequests.fromCode,
        amount: sql<string | null>`sum(${exchangeRequests.fromAmount}) filter (where ${completedWithin(current)})`,
        count: sql`count(*) filter (where ${completedWithin(current)})`.mapWith(Number),
        previousAmount: sql<string | null>`sum(${exchangeRequests.fromAmount}) filter (where ${completedWithin(previous)})`,
        previousCount: sql`count(*) filter (where ${completedWithin(previous)})`.mapWith(Number),
      })
      .from(exchangeRequests)
      .where(and(mine, or(completedWithin(current), completedWithin(previous))))
      .groupBy(exchangeRequests.fromCode),
    ctx.db
      .select({
        total: sql`count(*) filter (where ${periodOf(apiRequestLog.at, current)})`.mapWith(Number),
        failed: sql`count(*) filter (where ${periodOf(apiRequestLog.at, current)} and ${apiRequestLog.status} >= 400)`.mapWith(Number),
        previousTotal: sql`count(*) filter (where ${periodOf(apiRequestLog.at, previous)})`.mapWith(Number),
        previousFailed: sql`count(*) filter (where ${periodOf(apiRequestLog.at, previous)} and ${apiRequestLog.status} >= 400)`.mapWith(Number),
      })
      .from(apiRequestLog)
      .where(eq(apiRequestLog.merchantId, merchantId)),
    ctx.db
      .select({
        total: sql`count(*) filter (where ${periodOf(webhookDeliveries.createdAt, current)})`.mapWith(Number),
        failed: sql`count(*) filter (where ${periodOf(webhookDeliveries.createdAt, current)} and ${webhookDeliveries.status} = 'failed')`.mapWith(Number),
        previousTotal: sql`count(*) filter (where ${periodOf(webhookDeliveries.createdAt, previous)})`.mapWith(Number),
        previousFailed: sql`count(*) filter (where ${periodOf(webhookDeliveries.createdAt, previous)} and ${webhookDeliveries.status} = 'failed')`.mapWith(Number),
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookDeliveries.endpointId, webhookEndpoints.id))
      .where(eq(webhookEndpoints.merchantId, merchantId)),
    ctx.db
      .select({ day: submittedDay, n: count() })
      .from(exchangeRequests)
      .where(and(mine, submittedWithin(window)))
      .groupBy(submittedDay),
    ctx.db
      .select({ day: completedDay, n: count() })
      .from(exchangeRequests)
      .where(and(mine, completedWithin(window)))
      .groupBy(completedDay),
  ]);

  const counted = counts[0];
  const summary = (
    which: 'current' | 'previous',
    lines: readonly { code: string; amount: string | null; count: number }[],
    apiCalls: { total: number; failed: number },
    hooks: { total: number; failed: number },
  ): MerchantPeriodSummary => {
    const c = counted?.[which];
    return {
      submitted: c?.submitted ?? 0,
      completed: c?.completed ?? 0,
      cancelled: c?.cancelled ?? 0,
      open: c?.open ?? 0,
      turnover: toMoneyLines(lines.filter((row) => row.count > 0)),
      averageMinutesToComplete:
        c?.minutes === null || c?.minutes === undefined ? null : Number(c.minutes),
      apiCalls,
      webhookDeliveries: hooks,
    };
  };

  const call = calls[0];
  const hook = deliveries[0];
  const submittedBy = new Map(submittedByDay.map((row) => [row.day, row.n]));
  const completedBy = new Map(completedByDay.map((row) => [row.day, row.n]));
  // Дни окна по местному времени — все, включая пустые: столбики, в
  // которых пропали дни, читаются как столбики без провалов.
  const byDay: MerchantDay[] = [];
  for (let at = window.from.getTime(); at < window.to.getTime(); at += DAY_MS) {
    const day = dayKey(new Date(at), offset);
    byDay.push({ day, submitted: submittedBy.get(day) ?? 0, completed: completedBy.get(day) ?? 0 });
  }

  return {
    period: current,
    current: summary(
      'current',
      turnover.map((row) => ({ code: row.code, amount: row.amount, count: row.count })),
      { total: call?.total ?? 0, failed: call?.failed ?? 0 },
      { total: hook?.total ?? 0, failed: hook?.failed ?? 0 },
    ),
    previous: summary(
      'previous',
      turnover.map((row) => ({ code: row.code, amount: row.previousAmount, count: row.previousCount })),
      { total: call?.previousTotal ?? 0, failed: call?.previousFailed ?? 0 },
      { total: hook?.previousTotal ?? 0, failed: hook?.previousFailed ?? 0 },
    ),
    today: {
      submitted: counted?.today.submitted ?? 0,
      completed: counted?.today.completed ?? 0,
      cancelled: counted?.today.cancelled ?? 0,
    },
    byDay,
  };
}

/**
 * Активность мерчантов для списка в панели: исполнено с даты и оборот
 * по валютам — одним запросом на всех, а не по запросу на строку.
 * Мерчанта без исполненных в карте нет: пусто в строке — прочерк, а не
 * ноль рублей.
 */
export async function merchantActivitySince(
  ctx: CoreConfig,
  actor: Actor,
  since: Date,
): Promise<ReadonlyMap<string, MerchantActivity>> {
  requireStaff(actor);
  const rows = await ctx.db
    .select({
      merchantId: exchangeRequests.merchantId,
      code: exchangeRequests.fromCode,
      amount: sum(exchangeRequests.fromAmount),
      count: count(),
    })
    .from(exchangeRequests)
    .where(
      and(
        isNotNull(exchangeRequests.merchantId),
        eq(exchangeRequests.status, 'completed'),
        gte(exchangeRequests.completedAt, since),
      ),
    )
    .groupBy(exchangeRequests.merchantId, exchangeRequests.fromCode);

  const byMerchant = new Map<string, { completed: number; turnover: MoneyByCurrency[] }>();
  for (const row of rows) {
    if (!row.merchantId) continue;
    const entry = byMerchant.get(row.merchantId) ?? { completed: 0, turnover: [] };
    entry.completed += row.count;
    entry.turnover.push({
      code: row.code,
      amount: Money.toAmount(row.amount ?? '0'),
      count: row.count,
    });
    byMerchant.set(row.merchantId, entry);
  }
  for (const entry of byMerchant.values()) {
    entry.turnover.sort((a, b) => a.code.localeCompare(b.code));
  }
  return byMerchant;
}
