import { and, count, desc, eq, or, sql, sum } from 'drizzle-orm';
import { clientRequisites, exchangeRequests } from '@nemo/db';
import {
  Money,
  exchangeRequestStatuses,
  payoutMethodOf,
  type Amount,
  type ExchangeKind,
  type ExchangeRequestSource,
  type ExchangeRequestStatus,
  type PayoutMethod,
  type PromptPayIdType,
  type RequisiteKind,
} from '@nemo/types';
import type { Actor } from './actor.js';
import {
  type AnalyticsPeriod,
  DAY_MS,
  type MoneyByCurrency,
  type SeriesStep,
  cancelledWithin,
  completedWithin,
  dayKey,
  localHourOf,
  localStepOf,
  localWeekdayOf,
  requireOffset,
  requirePeriod,
  stepStartOf,
  submittedWithin,
} from './analytics.js';
import type { CoreConfig } from './context.js';
import { EXPIRED_REASON } from './expiry.js';
import { requireReadableMerchant } from './merchant-stats.js';

/**
 * Разрезы мерчанта: то же, что сводка, но по чему именно.
 *
 * Арифметика здесь не своя — она из ADR-0013 и живёт в условиях
 * `submittedWithin`, `completedWithin`, `cancelledWithin`: подано по
 * дате подачи, исполнено и деньги по дате исполнения, отмены по дате
 * отмены, валюты не складываются никогда. Новое тут одно — по чему
 * заявки раскладываются: направление, способ выдачи, получатель,
 * источник, час и день недели.
 *
 * Четыре разреза считаются одним запросом, а не четырьмя: строка
 * группировки у них общая — «направление, источник, получатель», — и
 * остальные три получаются из неё сложением. Четыре прохода по одной и
 * той же выборке разошлись бы в числах при первой правке условия.
 *
 * Получатель — не запись, а человек, которому платят: по API запись
 * заводится на каждую заявку и тут же архивируется, и разрез по
 * записям показал бы двадцать строк об одной карте. Считается он по
 * тому, что о получателе видно без расшифровки, — банк и хвост номера:
 * то же самое видит мерчант в списке получателей.
 */

/** Числа одного разреза — те же, что в плитках сводки. */
export interface MerchantSlice {
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  /**
   * Дошедшие из поданных в период — числитель конверсии строки.
   *
   * Отдельным числом, а не делением «исполнено» на «подано»: те
   * посчитаны по разным датам, и в неделю, когда разгребают хвост,
   * такая дробь дала бы четыреста процентов. То же правило и та же
   * причина, что у конверсии в сводке.
   */
  readonly converted: number;
  /** Отдано по исполненным в период — по валютам, порознь. */
  readonly turnover: readonly MoneyByCurrency[];
}

export interface MerchantDirectionSlice extends MerchantSlice {
  readonly fromCode: string;
  readonly toCode: string;
  readonly kind: ExchangeKind;
}

export interface MerchantMethodSlice extends MerchantSlice {
  /** Пусто у заявки без получателя: способ выдачи ей назовёт менеджер. */
  readonly method: PayoutMethod | null;
}

export interface MerchantSourceSlice extends MerchantSlice {
  /** Пусто у поданных до появления отметки: угаданный источник хуже пустого. */
  readonly source: ExchangeRequestSource | null;
}

/**
 * Получатель глазами мерчанта: род записи и то, что видно без
 * расшифровки. Номера здесь нет и не бывает — его открывает только
 * панель менеджера (docs/adr/0002).
 */
export interface MerchantRecipientSlice extends MerchantSlice {
  readonly kind: RequisiteKind | null;
  readonly bankName: string | null;
  readonly phone: string | null;
  readonly cardLast4: string | null;
  readonly network: string | null;
  readonly addressHint: string | null;
  readonly holderName: string | null;
  readonly accountLast4: string | null;
  readonly qrHint: string | null;
  readonly promptpayIdType: PromptPayIdType | null;
  readonly alipayAccount: string | null;
}

export interface MerchantSeriesPoint {
  /** Начало шага, «2026-09-02» по местному времени того, кто смотрит. */
  readonly at: string;
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly turnover: readonly MoneyByCurrency[];
}

/**
 * Воронка поданных в период — по текущему состоянию.
 *
 * Просрочка стоит рядом со ступенями, а не ступенью: своего состояния у
 * неё нет, отменённой её делает срок оплаты, и отличает её только
 * причина отмены. Число это — часть `cancelled`, а не добавка к нему.
 */
export interface MerchantFunnel {
  readonly stages: readonly {
    readonly status: ExchangeRequestStatus;
    readonly count: number;
  }[];
  readonly expired: number;
}

export interface MerchantBiggest {
  readonly code: string;
  readonly amount: Amount;
  readonly requestId: string;
  readonly reference: string | null;
}

export interface MerchantFastest {
  readonly requestId: string;
  readonly reference: string | null;
  readonly minutes: number;
}

export interface MerchantRecords {
  /** День периода с наибольшим числом поданных. Без заявок — пусто. */
  readonly busiestDay: { readonly day: string; readonly submitted: number } | null;
  /** Крупнейшая исполненная — по каждой валюте отдачи своя: складывать их нечем. */
  readonly largest: readonly MerchantBiggest[];
  readonly fastest: MerchantFastest | null;
  readonly slowest: MerchantFastest | null;
}

export interface MerchantBreakdowns {
  readonly period: AnalyticsPeriod;
  readonly step: SeriesStep;
  readonly series: readonly MerchantSeriesPoint[];
  readonly funnel: MerchantFunnel;
  readonly byDirection: readonly MerchantDirectionSlice[];
  readonly byPayoutMethod: readonly MerchantMethodSlice[];
  readonly byRecipient: readonly MerchantRecipientSlice[];
  /**
   * Скольких получателей в список не поместили. Предел у выборки есть
   * всегда: у мерчанта с тысячей покупателей таблица на тысячу строк не
   * читается ни на экране, ни в файле, а молча обрезанный список врал
   * бы о том, сколько их было.
   */
  readonly recipientsHidden: number;
  readonly bySource: readonly MerchantSourceSlice[];
  /** Двадцать четыре часа, включая пустые: провал в ряду — это тоже ответ. */
  readonly byHour: readonly { readonly hour: number; readonly submitted: number }[];
  /** Семь дней недели, понедельник первым. */
  readonly byWeekday: readonly { readonly weekday: number; readonly submitted: number }[];
  readonly records: MerchantRecords;
}

export interface MerchantBreakdownOptions {
  /** Смещение часового пояса того, кто смотрит, минуты к востоку от UTC. */
  readonly offsetMinutes?: number | undefined;
  /** Шаг сетки динамики. Не задан — сутки. */
  readonly step?: SeriesStep | undefined;
}

/** Сколько строк получателей отдаётся: дальше таблицу не читают. */
const RECIPIENTS_SHOWN = 50;

/** Накопитель разреза: суммы по валютам копятся картой, а не списком. */
interface Bucket {
  submitted: number;
  completed: number;
  cancelled: number;
  converted: number;
  turnover: Map<string, { amount: Amount; count: number }>;
}

function emptyBucket(): Bucket {
  return { submitted: 0, completed: 0, cancelled: 0, converted: 0, turnover: new Map() };
}

function addTo(bucket: Bucket, row: ComboRow): void {
  bucket.submitted += row.submitted;
  bucket.completed += row.completed;
  bucket.cancelled += row.cancelled;
  bucket.converted += row.converted;
  if (row.completed === 0) return;
  const line = bucket.turnover.get(row.fromCode) ?? { amount: Money.ZERO, count: 0 };
  bucket.turnover.set(row.fromCode, {
    amount: Money.add(line.amount, Money.toAmount(row.amount ?? '0')),
    count: line.count + row.completed,
  });
}

function moneyOf(bucket: Bucket): MoneyByCurrency[] {
  return [...bucket.turnover.entries()]
    .map(([code, line]) => ({ code, amount: line.amount, count: line.count }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function sliceOf(bucket: Bucket): MerchantSlice {
  return {
    submitted: bucket.submitted,
    completed: bucket.completed,
    cancelled: bucket.cancelled,
    converted: bucket.converted,
    turnover: moneyOf(bucket),
  };
}

/**
 * Порядок строк разреза: сверху то, чего больше. Сравнение по поданным,
 * потом по исполненным — иначе две строки с одинаковым числом менялись
 * бы местами между обновлениями экрана.
 */
function byWeight(a: MerchantSlice, b: MerchantSlice): number {
  return b.submitted - a.submitted || b.completed - a.completed;
}

interface ComboRow {
  readonly fromCode: string;
  readonly toCode: string;
  readonly kind: ExchangeKind;
  readonly source: ExchangeRequestSource | null;
  readonly requisiteKind: RequisiteKind | null;
  readonly bankName: string | null;
  readonly phone: string | null;
  readonly cardLast4: string | null;
  readonly network: string | null;
  readonly addressHint: string | null;
  readonly holderName: string | null;
  readonly accountLast4: string | null;
  readonly qrHint: string | null;
  readonly promptpayIdType: PromptPayIdType | null;
  readonly alipayAccount: string | null;
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly converted: number;
  readonly amount: string | null;
}

/**
 * Ключ получателя — всё, что о нём видно без расшифровки.
 *
 * Поля разделены знаком, которого в них не бывает: на пробеле «Т-Банк
 * А» с пустым телефоном и «Т-Банк» с телефоном «А» дали бы один ключ, и
 * две карты слились бы в одну строку разреза.
 */
function recipientKey(row: ComboRow): string {
  return [
    row.requisiteKind,
    row.bankName,
    row.phone,
    row.cardLast4,
    row.network,
    row.addressHint,
    row.holderName,
    row.accountLast4,
    row.qrHint,
    row.promptpayIdType,
    row.alipayAccount,
  ].join('\u0000');
}

export async function breakdownMerchant(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
  period: AnalyticsPeriod,
  options: MerchantBreakdownOptions = {},
): Promise<MerchantBreakdowns> {
  await requireReadableMerchant(ctx, actor, merchantId);
  const window = requirePeriod(period);
  const offset = requireOffset(options.offsetMinutes);
  const step = options.step ?? 'day';

  const mine = eq(exchangeRequests.merchantId, merchantId);
  const submittedIn = submittedWithin(window);
  const completedIn = completedWithin(window);
  const cancelledIn = cancelledWithin(window);
  const touched = or(submittedIn, completedIn, cancelledIn)!;

  const submittedStep = localStepOf(exchangeRequests.createdAt, offset, step);
  const completedStep = localStepOf(exchangeRequests.completedAt, offset, step);
  const cancelledStep = localStepOf(exchangeRequests.updatedAt, offset, step);
  const hour = localHourOf(exchangeRequests.createdAt, offset);
  const weekday = localWeekdayOf(exchangeRequests.createdAt, offset);
  /*
   * Сколько заявка шла от подачи до исполнения — выражением, а не
   * разностью в коде: по нему же идёт сортировка, и посчитанное дважды
   * рекорд и его длительность могли бы разойтись.
   */
  const minutes = sql<string>`extract(epoch from (${exchangeRequests.completedAt} - ${exchangeRequests.createdAt})) / 60`;

  const [
    combos,
    submittedSeries,
    completedSeries,
    cancelledSeries,
    stages,
    clock,
    largest,
    fastest,
    slowest,
  ] = await Promise.all([
    ctx.db
      .select({
        fromCode: exchangeRequests.fromCode,
        toCode: exchangeRequests.toCode,
        kind: exchangeRequests.kind,
        source: exchangeRequests.source,
        requisiteKind: clientRequisites.kind,
        bankName: clientRequisites.bankName,
        phone: clientRequisites.phone,
        cardLast4: clientRequisites.cardLast4,
        network: clientRequisites.network,
        addressHint: clientRequisites.addressHint,
        holderName: clientRequisites.holderName,
        accountLast4: clientRequisites.accountLast4,
        qrHint: clientRequisites.qrHint,
        promptpayIdType: clientRequisites.promptpayIdType,
        alipayAccount: clientRequisites.alipayAccount,
        submitted: sql`count(*) filter (where ${submittedIn})`.mapWith(Number),
        completed: sql`count(*) filter (where ${completedIn})`.mapWith(Number),
        cancelled: sql`count(*) filter (where ${cancelledIn})`.mapWith(Number),
        converted: sql`count(*) filter (where ${submittedIn} and ${eq(exchangeRequests.status, 'completed')})`.mapWith(
          Number,
        ),
        amount: sql<
          string | null
        >`sum(${exchangeRequests.fromAmount}) filter (where ${completedIn})`,
      })
      .from(exchangeRequests)
      .leftJoin(clientRequisites, eq(exchangeRequests.requisitesId, clientRequisites.id))
      .where(and(mine, touched))
      .groupBy(
        exchangeRequests.fromCode,
        exchangeRequests.toCode,
        exchangeRequests.kind,
        exchangeRequests.source,
        clientRequisites.kind,
        clientRequisites.bankName,
        clientRequisites.phone,
        clientRequisites.cardLast4,
        clientRequisites.network,
        clientRequisites.addressHint,
        clientRequisites.holderName,
        clientRequisites.accountLast4,
        clientRequisites.qrHint,
        clientRequisites.promptpayIdType,
        clientRequisites.alipayAccount,
      ),
    ctx.db
      .select({ at: submittedStep, n: count() })
      .from(exchangeRequests)
      .where(and(mine, submittedIn))
      .groupBy(submittedStep),
    ctx.db
      .select({
        at: completedStep,
        code: exchangeRequests.fromCode,
        amount: sum(exchangeRequests.fromAmount),
        n: count(),
      })
      .from(exchangeRequests)
      .where(and(mine, completedIn))
      .groupBy(completedStep, exchangeRequests.fromCode),
    ctx.db
      .select({ at: cancelledStep, n: count() })
      .from(exchangeRequests)
      .where(and(mine, cancelledIn))
      .groupBy(cancelledStep),
    ctx.db
      .select({
        status: exchangeRequests.status,
        n: count(),
        expired: sql`count(*) filter (where ${eq(exchangeRequests.cancelReason, EXPIRED_REASON)})`
          .mapWith(Number),
      })
      .from(exchangeRequests)
      .where(and(mine, submittedIn))
      .groupBy(exchangeRequests.status),
    ctx.db
      .select({ hour, weekday, n: count() })
      .from(exchangeRequests)
      .where(and(mine, submittedIn))
      .groupBy(hour, weekday),
    ctx.db
      .selectDistinctOn([exchangeRequests.fromCode], {
        code: exchangeRequests.fromCode,
        amount: exchangeRequests.fromAmount,
        requestId: exchangeRequests.id,
        reference: exchangeRequests.reference,
      })
      .from(exchangeRequests)
      .where(and(mine, completedIn))
      .orderBy(exchangeRequests.fromCode, desc(exchangeRequests.fromAmount)),
    ctx.db
      .select({ requestId: exchangeRequests.id, reference: exchangeRequests.reference, minutes })
      .from(exchangeRequests)
      .where(and(mine, completedIn))
      // Ровня по длительности разводится временем исполнения: без
      // второго ключа порядок у неё меняется от запроса к запросу.
      .orderBy(sql`${minutes} asc`, exchangeRequests.completedAt)
      .limit(1),
    ctx.db
      .select({ requestId: exchangeRequests.id, reference: exchangeRequests.reference, minutes })
      .from(exchangeRequests)
      .where(and(mine, completedIn))
      .orderBy(sql`${minutes} desc`, exchangeRequests.completedAt)
      .limit(1),
  ]);

  /* ── Четыре разреза из одной группировки ───────────────────────── */

  const directions = new Map<string, { row: ComboRow; bucket: Bucket }>();
  const methods = new Map<PayoutMethod | 'none', Bucket>();
  const recipients = new Map<string, { row: ComboRow; bucket: Bucket }>();
  const sources = new Map<ExchangeRequestSource | 'none', Bucket>();

  for (const row of combos as ComboRow[]) {
    const direction = `${row.fromCode}\u0000${row.toCode}\u0000${row.kind}`;
    const inDirection = directions.get(direction) ?? { row, bucket: emptyBucket() };
    addTo(inDirection.bucket, row);
    directions.set(direction, inDirection);

    const method =
      row.requisiteKind === null
        ? 'none'
        : payoutMethodOf({ kind: row.requisiteKind, promptpayIdType: row.promptpayIdType });
    const inMethod = methods.get(method) ?? emptyBucket();
    addTo(inMethod, row);
    methods.set(method, inMethod);

    const recipient = recipientKey(row);
    const inRecipient = recipients.get(recipient) ?? { row, bucket: emptyBucket() };
    addTo(inRecipient.bucket, row);
    recipients.set(recipient, inRecipient);

    const source = row.source ?? 'none';
    const inSource = sources.get(source) ?? emptyBucket();
    addTo(inSource, row);
    sources.set(source, inSource);
  }

  const byDirection = [...directions.values()]
    .map(({ row, bucket }) => ({
      fromCode: row.fromCode,
      toCode: row.toCode,
      kind: row.kind,
      ...sliceOf(bucket),
    }))
    .sort(byWeight);

  const byPayoutMethod = [...methods.entries()]
    .map(([method, bucket]) => ({
      method: method === 'none' ? null : method,
      ...sliceOf(bucket),
    }))
    .sort(unknownLast((one) => one.method));

  const allRecipients = [...recipients.values()]
    .map(({ row, bucket }) => ({
      kind: row.requisiteKind,
      bankName: row.bankName,
      phone: row.phone,
      cardLast4: row.cardLast4,
      network: row.network,
      addressHint: row.addressHint,
      holderName: row.holderName,
      accountLast4: row.accountLast4,
      qrHint: row.qrHint,
      promptpayIdType: row.promptpayIdType,
      alipayAccount: row.alipayAccount,
      ...sliceOf(bucket),
    }))
    .sort(unknownLast((one) => one.kind));
  const byRecipient = allRecipients.slice(0, RECIPIENTS_SHOWN);

  const bySource = [...sources.entries()]
    .map(([source, bucket]) => ({
      source: source === 'none' ? null : source,
      ...sliceOf(bucket),
    }))
    .sort(unknownLast((one) => one.source));

  /* ── Динамика ──────────────────────────────────────────────────── */

  const submittedBy = new Map(submittedSeries.map((row) => [row.at, row.n]));
  const cancelledBy = new Map(cancelledSeries.map((row) => [row.at, row.n]));
  const completedBy = new Map<string, Bucket>();
  for (const row of completedSeries) {
    const point = completedBy.get(row.at) ?? emptyBucket();
    point.completed += row.n;
    point.turnover.set(row.code, {
      amount: Money.toAmount(row.amount ?? '0'),
      count: row.n,
    });
    completedBy.set(row.at, point);
  }

  // Шаги периода — все, включая пустые: ряд, из которого пропали дни,
  // читается как ряд без провалов.
  const steps: string[] = [];
  for (let moment = window.from.getTime(); moment < window.to.getTime(); moment += DAY_MS) {
    const key = stepStartOf(dayKey(new Date(moment), offset), step);
    if (steps[steps.length - 1] !== key) steps.push(key);
  }
  const series: MerchantSeriesPoint[] = steps.map((at) => {
    const done = completedBy.get(at);
    return {
      at,
      submitted: submittedBy.get(at) ?? 0,
      completed: done?.completed ?? 0,
      cancelled: cancelledBy.get(at) ?? 0,
      turnover: done ? moneyOf(done) : [],
    };
  });

  /* ── Воронка и рекорды ─────────────────────────────────────────── */

  const byStatus = new Map(stages.map((row) => [row.status, row.n]));
  const funnel: MerchantFunnel = {
    // Все состояния, и нулевые тоже: пропавшая ступень читалась бы как
    // «такого не случалось».
    stages: exchangeRequestStatuses.map((status) => ({
      status,
      count: byStatus.get(status) ?? 0,
    })),
    expired: stages.reduce((total, row) => total + row.expired, 0),
  };

  const busiest = series.reduce<MerchantSeriesPoint | null>(
    (best, one) => (one.submitted > 0 && (best === null || one.submitted > best.submitted) ? one : best),
    null,
  );

  return {
    period: window,
    step,
    series,
    funnel,
    byDirection,
    byPayoutMethod,
    byRecipient,
    recipientsHidden: allRecipients.length - byRecipient.length,
    bySource,
    byHour: Array.from({ length: 24 }, (_, at) => ({
      hour: at,
      submitted: clock
        .filter((row) => row.hour === at)
        .reduce((total, row) => total + row.n, 0),
    })),
    byWeekday: Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      submitted: clock
        .filter((row) => row.weekday === index + 1)
        .reduce((total, row) => total + row.n, 0),
    })),
    records: {
      busiestDay: busiest === null ? null : { day: busiest.at, submitted: busiest.submitted },
      largest: largest
        .map((row) => ({
          code: row.code,
          amount: Money.toAmount(row.amount),
          requestId: row.requestId,
          reference: row.reference,
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      fastest: takeRecord(fastest),
      slowest: takeRecord(slowest),
    },
  };
}

/**
 * Порядок строк, у которых бывает «не записано»: сначала по весу, а
 * пустое — всегда последним, сколько бы его ни было. Оно не строка
 * разреза, а признание, что об этих заявках сказать нечего.
 */
function unknownLast<T extends MerchantSlice>(
  nameOf: (one: T) => unknown,
): (a: T, b: T) => number {
  return (a, b) => {
    const unknownA = nameOf(a) === null ? 1 : 0;
    const unknownB = nameOf(b) === null ? 1 : 0;
    return unknownA - unknownB || byWeight(a, b);
  };
}

function takeRecord(
  rows: readonly { requestId: string; reference: string | null; minutes: string }[],
): MerchantFastest | null {
  const row = rows[0];
  if (row === undefined) return null;
  return { requestId: row.requestId, reference: row.reference, minutes: Number(row.minutes) };
}
