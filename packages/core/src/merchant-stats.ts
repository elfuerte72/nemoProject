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
  type AnalyticsPeriod,
  DAY_MS,
  type MoneyByCurrency,
  SERIES_BUCKETS,
  type SeriesStep,
  cancelledWithin,
  completedWithin,
  dayKey,
  localMidnight,
  localStepOf,
  merchantRequests,
  minutesToComplete,
  periodOf,
  previousPeriod,
  requireOffset,
  requirePeriod,
  requireStep,
  stepsBack,
  stillOpen,
  submittedWithin,
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
  /**
   * Исполненных среди поданных в период, 0..1; без поданных — null.
   *
   * Считается по одним и тем же заявкам, а не делением «исполнено» на
   * «подано»: те посчитаны по разным датам, и в неделю, когда разгребли
   * хвост, такая дробь дала бы конверсию больше единицы.
   */
  readonly conversion: number | null;
  /** Отдано мерчантом по исполненным в период — по валюте отдачи. */
  readonly turnover: readonly MoneyByCurrency[];
  /**
   * Выдано получателям по исполненным в период — по валюте выдачи.
   * Вторая сторона оборота: отдать мерчант может только рубли и USDT, а
   * выдаётся любая из валют сервиса, и без этого числа бат или юань
   * видны только в разрезах.
   */
  readonly payout: readonly MoneyByCurrency[];
  /** От подачи до исполнения, минуты, по исполненным в период. */
  readonly averageMinutesToComplete: number | null;
  /** Вызовов API за период и сколько из них отвергнуто. */
  readonly apiCalls: { readonly total: number; readonly failed: number };
  /** Доставок вебхуков, заведённых в период, и сколько не доставлено. */
  readonly webhookDeliveries: { readonly total: number; readonly failed: number };
}

export interface MerchantSeriesBar {
  /**
   * Начало корзины — днём «2026-09-02» по местному времени того, кто
   * смотрит. У шага «день» это сам день, у недели — понедельник, у
   * месяца и квартала — первое число; вид ключа один на все четыре, и
   * разбирать его на экране не приходится.
   */
  readonly at: string;
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
  /** Шаг столбиков: по нему же считается, насколько глубок ряд. */
  readonly step: SeriesStep;
  /**
   * Подано и исполнено по шагу — до «сейчас», с нулями в пустых
   * корзинах. Период наверху ряду не указ: он отвечает на «как шли
   * дела», а не «сколько за выбранные семь дней», и глубину ему задаёт
   * шаг — две недели по дням, двенадцать недель, год по месяцам, два
   * года по кварталам.
   */
  readonly series: readonly MerchantSeriesBar[];
}

export interface MerchantStatsOptions {
  /** Смещение часового пояса того, кто смотрит, минуты к востоку от UTC. */
  readonly offsetMinutes?: number | undefined;
  /** «Сейчас»: от него считаются «сегодня» и столбики ряда. Не задано — часы сервера. */
  readonly now?: Date | undefined;
  /** Шаг столбиков. Не задан — сутки. */
  readonly step?: SeriesStep | undefined;
  /**
   * Только заявки, поданные этим человеком кабинета, — «Только я» в
   * аналитике. Вызовы API и доставки вебхуков при этом остаются общими:
   * ключ принадлежит кабинету, а не человеку, и своих вызовов у
   * сотрудника не бывает — экран их в этом отборе не показывает.
   */
  readonly submittedBy?: string | undefined;
}

/** Исполнено с даты и оборот по валютам — строка списка мерчантов. */
export interface MerchantActivity {
  readonly completed: number;
  readonly turnover: readonly MoneyByCurrency[];
}

/**
 * Кому можно читать сводку: мерчанту — свою, сотруднику — любую.
 *
 * Чужая для мерчанта — «не найдена», как чужая заявка: отличать одно от
 * другого значило бы подтверждать существование тому, кто перебирает.
 * Существование сверяется только для сотрудника: мерчант, который
 * спрашивает о себе, уже доказал его сессией.
 */
export async function requireReadableMerchant(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
): Promise<void> {
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
    // Дошедшие из поданных в период — числитель конверсии. Считается
    // по тем же заявкам, что и знаменатель: «исполнено» посчитано по
    // другой дате и для этой дроби не годится.
    converted: sql`count(*) filter (where ${submittedIn} and ${eq(exchangeRequests.status, 'completed')})`.mapWith(
      Number,
    ),
    completed: sql`count(*) filter (where ${completedIn})`.mapWith(Number),
    cancelled: sql`count(*) filter (where ${cancelledWithin(period)})`.mapWith(Number),
    minutes: sql<string | null>`${minutesToComplete} filter (where ${completedIn})`,
  };
}

interface Counted {
  readonly submitted: number;
  readonly converted: number;
  readonly open: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly minutes: string | null;
}

export async function summarizeMerchant(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
  period: AnalyticsPeriod,
  options: MerchantStatsOptions = {},
): Promise<MerchantStats> {
  await requireReadableMerchant(ctx, actor, merchantId);
  const current = requirePeriod(period);
  const previous = previousPeriod(current);
  const offset = requireOffset(options.offsetMinutes);
  const now = options.now ?? new Date();
  const todayStart = localMidnight(now, offset);
  const tomorrow = new Date(todayStart.getTime() + DAY_MS);
  const today = { from: todayStart, to: tomorrow };
  const step = requireStep(options.step);
  /*
   * Окно ряда считается корзинами, а не сутками: у месяца их то
   * тридцать, то двадцать восемь, и «год назад» через умножение на
   * DAY_MS попадал бы в середину месяца, оставляя первую корзину
   * надкушенной. Начало — местная полночь первой корзины.
   */
  const todayKey = dayKey(now, offset);
  const buckets = SERIES_BUCKETS[step];
  const first = stepsBack(todayKey, step, buckets - 1);
  const window = {
    from: new Date(Date.parse(`${first}T00:00:00Z`) - offset * 60_000),
    to: tomorrow,
  };

  const mine = merchantRequests(merchantId, options.submittedBy);
  // Группирует база, а не память: корзин у квартального ряда восемь, а
  // дней за два года — семьсот с лишним, и возить их в приложение ради
  // сложения нечего.
  const submittedStep = localStepOf(exchangeRequests.createdAt, offset, step);
  const completedStep = localStepOf(exchangeRequests.completedAt, offset, step);

  const [counts, turnover, payout, calls, deliveries, submittedByStep, completedByStep] = await Promise.all([
    ctx.db
      .select({
        current: sql<Counted>`json_build_object('submitted', ${countColumns(current).submitted}, 'converted', ${countColumns(current).converted}, 'open', ${countColumns(current).open}, 'completed', ${countColumns(current).completed}, 'cancelled', ${countColumns(current).cancelled}, 'minutes', ${countColumns(current).minutes})`,
        previous: sql<Counted>`json_build_object('submitted', ${countColumns(previous).submitted}, 'converted', ${countColumns(previous).converted}, 'open', ${countColumns(previous).open}, 'completed', ${countColumns(previous).completed}, 'cancelled', ${countColumns(previous).cancelled}, 'minutes', ${countColumns(previous).minutes})`,
        today: sql<Counted>`json_build_object('submitted', ${countColumns(today).submitted}, 'converted', 0, 'open', 0, 'completed', ${countColumns(today).completed}, 'cancelled', ${countColumns(today).cancelled}, 'minutes', null)`,
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
    // Выдано — тем же приёмом по валюте выдачи. Сумма без курса бывает
    // пустой, пока его не назвали; у исполненной она есть всегда, но
    // пустая сложилась бы в ноль и прибавила заявку к счёту.
    ctx.db
      .select({
        code: exchangeRequests.toCode,
        amount: sql<string | null>`sum(${exchangeRequests.toAmount}) filter (where ${completedWithin(current)})`,
        count: sql`count(*) filter (where ${completedWithin(current)})`.mapWith(Number),
        previousAmount: sql<string | null>`sum(${exchangeRequests.toAmount}) filter (where ${completedWithin(previous)})`,
        previousCount: sql`count(*) filter (where ${completedWithin(previous)})`.mapWith(Number),
      })
      .from(exchangeRequests)
      .where(
        and(
          mine,
          isNotNull(exchangeRequests.toAmount),
          or(completedWithin(current), completedWithin(previous)),
        ),
      )
      .groupBy(exchangeRequests.toCode),
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
      .select({ at: submittedStep, n: count() })
      .from(exchangeRequests)
      .where(and(mine, submittedWithin(window)))
      .groupBy(submittedStep),
    ctx.db
      .select({ at: completedStep, n: count() })
      .from(exchangeRequests)
      .where(and(mine, completedWithin(window)))
      .groupBy(completedStep),
  ]);

  const counted = counts[0];
  const summary = (
    which: 'current' | 'previous',
    lines: readonly { code: string; amount: string | null; count: number }[],
    paid: readonly { code: string; amount: string | null; count: number }[],
    apiCalls: { total: number; failed: number },
    hooks: { total: number; failed: number },
  ): MerchantPeriodSummary => {
    const c = counted?.[which];
    return {
      submitted: c?.submitted ?? 0,
      completed: c?.completed ?? 0,
      cancelled: c?.cancelled ?? 0,
      open: c?.open ?? 0,
      conversion: c === undefined || c.submitted === 0 ? null : c.converted / c.submitted,
      turnover: toMoneyLines(lines.filter((row) => row.count > 0)),
      payout: toMoneyLines(paid.filter((row) => row.count > 0)),
      averageMinutesToComplete:
        c?.minutes === null || c?.minutes === undefined ? null : Number(c.minutes),
      apiCalls,
      webhookDeliveries: hooks,
    };
  };

  const call = calls[0];
  const hook = deliveries[0];
  const submittedBy = new Map(submittedByStep.map((row) => [row.at, row.n]));
  const completedBy = new Map(completedByStep.map((row) => [row.at, row.n]));
  /*
   * Корзины окна — все, включая пустые: ряд, из которого выпали тихие
   * дни, читается как ряд без провалов. Перебираются они сдвигом назад
   * от сегодняшней, а не шагом вперёд от первой: правило о границе
   * корзины тогда одно и то же, и последняя корзина гарантированно
   * приходится на сегодня.
   */
  const series: MerchantSeriesBar[] = Array.from({ length: buckets }, (_, index) => {
    const at = stepsBack(todayKey, step, buckets - 1 - index);
    return { at, submitted: submittedBy.get(at) ?? 0, completed: completedBy.get(at) ?? 0 };
  });

  return {
    period: current,
    current: summary(
      'current',
      turnover.map((row) => ({ code: row.code, amount: row.amount, count: row.count })),
      payout.map((row) => ({ code: row.code, amount: row.amount, count: row.count })),
      { total: call?.total ?? 0, failed: call?.failed ?? 0 },
      { total: hook?.total ?? 0, failed: hook?.failed ?? 0 },
    ),
    previous: summary(
      'previous',
      turnover.map((row) => ({ code: row.code, amount: row.previousAmount, count: row.previousCount })),
      payout.map((row) => ({ code: row.code, amount: row.previousAmount, count: row.previousCount })),
      { total: call?.previousTotal ?? 0, failed: call?.previousFailed ?? 0 },
      { total: hook?.previousTotal ?? 0, failed: hook?.previousFailed ?? 0 },
    ),
    today: {
      submitted: counted?.today.submitted ?? 0,
      completed: counted?.today.completed ?? 0,
      cancelled: counted?.today.cancelled ?? 0,
    },
    step,
    series,
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
