import { and, count, desc, eq, lt, or, sql, sum } from 'drizzle-orm';
import { clientRequisites, exchangeRequests, merchantUsers } from '@nemo/db';
import {
  Money,
  exchangeRequestStatuses,
  payoutMethodOf,
  type Amount,
  type ExchangeKind,
  type ExchangeRequestSource,
  type ExchangeRequestStatus,
  type MerchantUserRole,
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
  merchantRequests,
  requirePeriod,
  requireStep,
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

/**
 * Кто подал внутри мерчанта (тикет 17). Имя, а не почта: в таблице
 * узнают человека, а не адрес, по которому он входит.
 */
export interface MerchantStaffSlice extends MerchantSlice {
  /** Пусто у заявок по ключу API — он ничей — и у поданных до отметки. */
  readonly userId: string | null;
  readonly name: string | null;
  /** Роль сейчас, а не в день подачи: таблица отвечает «кто это», а не «кем был». */
  readonly role: MerchantUserRole | null;
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
  /** Когда ему подали последнюю заявку в периоде. Без поданных в период — пусто. */
  readonly lastSubmittedAt: Date | null;
  /**
   * Первая заявка ему за всё время мерчанта пришлась на период: раньше
   * мерчант ему заявок не подавал. Считается по подаче, а не по оплате —
   * как «новые в базе» у образца: появился в базе тот, кому подали, чем
   * бы заявка ни кончилась. И по всем заявкам кабинета, а не по отбору
   * «только я»: «новый» — про получателя, а не про того, кто подал.
   */
  readonly fresh: boolean;
}

/**
 * Получатели периода числами — то, чем у Love&Pay служат «клиенты».
 * Считаются по всем, а не по показанным строкам: у списка предел, у
 * этих чисел его нет.
 */
export interface MerchantRecipientCounts {
  /** Скольким подали хотя бы одну заявку в период. */
  readonly total: number;
  /** Из них впервые — раньше мерчант им заявок не подавал. */
  readonly fresh: number;
  /** Из них вернувшихся — тех, кому подавали и до периода. */
  readonly returning: number;
}

/**
 * Деньги одной валюты с обеих сторон: сколько мерчант отдал в ней и
 * сколько в ней получили получатели. Обе — по исполненным в период:
 * отданное и полученное по одной заявке лежат в одном дне.
 */
export interface MerchantCurrencySlice {
  readonly code: string;
  readonly given: { readonly amount: Amount; readonly count: number } | null;
  readonly received: { readonly amount: Amount; readonly count: number } | null;
}

export interface MerchantSeriesPoint {
  /** Начало шага, «2026-09-02» по местному времени того, кто смотрит. */
  readonly at: string;
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly turnover: readonly MoneyByCurrency[];
  /** Скольким разным получателям подали на этом шаге. */
  readonly recipients: number;
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
  /**
   * Шаг сетки с наибольшим числом поданных — сутки, неделя или месяц,
   * смотря чем меряет динамика. Шагом, а не днём: рекорд считается по
   * тому же ряду, который нарисован рядом, и «день» в названии врал бы
   * ровно тогда, когда шаг переключили на месяцы. Без заявок — пусто.
   */
  readonly busiestStep: { readonly at: string; readonly submitted: number } | null;
  /** Крупнейшая исполненная — по каждой валюте отдачи своя: складывать их нечем. */
  readonly largest: readonly MerchantBiggest[];
  readonly fastest: MerchantFastest | null;
  readonly slowest: MerchantFastest | null;
  /**
   * День с наибольшим числом исполненных — днём, какой бы шаг ни был
   * выбран у динамики: «лучший день» за неделю назвал бы неделю. Ровня
   * разводится ранним днём.
   */
  readonly bestDay: { readonly at: string; readonly completed: number } | null;
  /**
   * Середина сроков от подачи до исполнения, минуты. Рядом со средним:
   * одна заявка, зависшая на выходные, утаскивает среднее на часы, а
   * середину — нет.
   */
  readonly medianMinutes: number | null;
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
  /**
   * По тому, кто подал. У мерчанта-одиночки в нём одна строка — его
   * собственная, — и это честный ответ: разрез отвечает «кто работал»,
   * а не «сколько вас».
   */
  readonly byStaff: readonly MerchantStaffSlice[];
  /** Двадцать четыре часа, включая пустые: провал в ряду — это тоже ответ. */
  readonly byHour: readonly { readonly hour: number; readonly submitted: number }[];
  /** Семь дней недели, понедельник первым. */
  readonly byWeekday: readonly { readonly weekday: number; readonly submitted: number }[];
  /**
   * Карта нагрузки: поданные по дню недели и часу — семь строк,
   * понедельник первым, по двадцать четыре часа, включая пустые.
   */
  readonly load: readonly (readonly number[])[];
  readonly recipients: MerchantRecipientCounts;
  /** Отдано и получено по валютам — и те, в которых было только одно из двух. */
  readonly byCurrency: readonly MerchantCurrencySlice[];
  /**
   * Середина чека по валюте отдачи — рядом со средним на плитке.
   * Серединой служит сама заявка ряда, а не среднее двух соседних: число
   * с экрана можно найти в списке заявок.
   */
  readonly medianTicket: readonly { readonly code: string; readonly amount: Amount }[];
  readonly records: MerchantRecords;
}

export interface MerchantBreakdownOptions {
  /** Смещение часового пояса того, кто смотрит, минуты к востоку от UTC. */
  readonly offsetMinutes?: number | undefined;
  /** Шаг сетки динамики. Не задан — сутки. */
  readonly step?: SeriesStep | undefined;
  /** Только заявки, поданные этим человеком кабинета, — «Только я» в аналитике. */
  readonly submittedBy?: string | undefined;
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
  /** Последняя подача в период — моментом; пусто, пока поданных не было. */
  last: number | null;
}

function emptyBucket(): Bucket {
  return { submitted: 0, completed: 0, cancelled: 0, converted: 0, turnover: new Map(), last: null };
}

function addTo(bucket: Bucket, row: ComboRow): void {
  bucket.submitted += row.submitted;
  bucket.completed += row.completed;
  bucket.cancelled += row.cancelled;
  bucket.converted += row.converted;
  const last = row.last?.getTime() ?? null;
  if (last !== null && (bucket.last === null || last > bucket.last)) bucket.last = last;
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
  readonly submittedByUserId: string | null;
  readonly submittedByName: string | null;
  readonly submittedByRole: MerchantUserRole | null;
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
  /** Получено по исполненным в период — в валюте получения. */
  readonly received: string | null;
  readonly last: Date | null;
}

/**
 * Ключ получателя — всё, что о нём видно без расшифровки.
 *
 * Поля разделены знаком, которого в них не бывает: на пробеле «Т-Банк
 * А» с пустым телефоном и «Т-Банк» с телефоном «А» дали бы один ключ, и
 * две карты слились бы в одну строку разреза.
 */
type RecipientFields = Pick<
  ComboRow,
  | 'requisiteKind'
  | 'bankName'
  | 'phone'
  | 'cardLast4'
  | 'network'
  | 'addressHint'
  | 'holderName'
  | 'accountLast4'
  | 'qrHint'
  | 'promptpayIdType'
  | 'alipayAccount'
>;

function recipientKey(row: RecipientFields): string {
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
  const step = requireStep(options.step);

  const ofMerchant = eq(exchangeRequests.merchantId, merchantId);
  const mine = merchantRequests(merchantId, options.submittedBy);
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
  const completedDay = localStepOf(exchangeRequests.completedAt, offset, 'day');
  /*
   * Получатель в запросе — тем же набором полей, что и в ключе
   * `recipientKey`: сравнивать их строкой в памяти и записью в базе —
   * одно и то же правило, записанное дважды. Список колонок для
   * группировки берётся из того же выбора, а не набирается второй раз.
   */
  const recipientSelect = {
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
  };
  const recipientColumns = Object.values(recipientSelect);

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
    recipientsByStep,
    firstSubmitted,
    bestDay,
    medianTicket,
    medianMinutes,
  ] = await Promise.all([
    ctx.db
      .select({
        fromCode: exchangeRequests.fromCode,
        toCode: exchangeRequests.toCode,
        kind: exchangeRequests.kind,
        source: exchangeRequests.source,
        submittedByUserId: exchangeRequests.submittedByUserId,
        submittedByName: merchantUsers.name,
        submittedByRole: merchantUsers.role,
        ...recipientSelect,
        submitted: sql`count(*) filter (where ${submittedIn})`.mapWith(Number),
        completed: sql`count(*) filter (where ${completedIn})`.mapWith(Number),
        cancelled: sql`count(*) filter (where ${cancelledIn})`.mapWith(Number),
        converted: sql`count(*) filter (where ${submittedIn} and ${eq(exchangeRequests.status, 'completed')})`.mapWith(
          Number,
        ),
        amount: sql<
          string | null
        >`sum(${exchangeRequests.fromAmount}) filter (where ${completedIn})`,
        received: sql<
          string | null
        >`sum(${exchangeRequests.toAmount}) filter (where ${completedIn})`,
        last: sql<Date | null>`max(${exchangeRequests.createdAt}) filter (where ${submittedIn})`.mapWith(
          exchangeRequests.createdAt,
        ),
      })
      .from(exchangeRequests)
      .leftJoin(clientRequisites, eq(exchangeRequests.requisitesId, clientRequisites.id))
      // Левым: у заявки по ключу API подавшего нет, и внутреннее
      // соединение вычеркнуло бы её из всех пяти разрезов разом.
      .leftJoin(merchantUsers, eq(exchangeRequests.submittedByUserId, merchantUsers.id))
      .where(and(mine, touched))
      .groupBy(
        exchangeRequests.fromCode,
        exchangeRequests.toCode,
        exchangeRequests.kind,
        exchangeRequests.source,
        exchangeRequests.submittedByUserId,
        merchantUsers.name,
        merchantUsers.role,
        ...recipientColumns,
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
    /*
     * Разных получателей на шаге — записью из видимых полей, а не
     * ссылкой на запись: по API запись заводится на каждую заявку, и
     * счёт ссылок назвал бы двадцать человек там, где была одна карта.
     */
    ctx.db
      .select({
        at: submittedStep,
        n: sql`count(distinct (${sql.join(
          recipientColumns.map((column) => sql`${column}`),
          sql`, `,
        )}))`.mapWith(Number),
      })
      .from(exchangeRequests)
      .innerJoin(clientRequisites, eq(exchangeRequests.requisitesId, clientRequisites.id))
      .where(and(mine, submittedIn))
      .groupBy(submittedStep),
    /*
     * Когда каждому получателю мерчант впервые подал заявку — за всё
     * время и по всему кабинету, чем бы она ни кончилась: «новый» —
     * свойство получателя, и отбор «только я» его не меняет. Считается
     * по подаче, а не по оплате (см. `fresh`). Спрашивается только о
     * тех, кто в период попал.
     */
    ctx.db
      .select({
        ...recipientSelect,
        first: sql<Date>`min(${exchangeRequests.createdAt})`.mapWith(exchangeRequests.createdAt),
      })
      .from(exchangeRequests)
      .innerJoin(clientRequisites, eq(exchangeRequests.requisitesId, clientRequisites.id))
      .where(and(ofMerchant, lt(exchangeRequests.createdAt, window.to)))
      .groupBy(...recipientColumns)
      // Граница — с явным типом: у агрегата нет колонки, по которой
      // драйвер узнал бы, что перед ним момент, а не строка.
      .having(sql`max(${exchangeRequests.createdAt}) >= ${window.from.toISOString()}::timestamptz`),
    ctx.db
      .select({ at: completedDay, n: count() })
      .from(exchangeRequests)
      .where(and(mine, completedIn))
      .groupBy(completedDay)
      .orderBy(sql`count(*) desc`, completedDay)
      .limit(1),
    ctx.db
      .select({
        code: exchangeRequests.fromCode,
        amount: sql<string>`percentile_disc(0.5) within group (order by ${exchangeRequests.fromAmount})`,
      })
      .from(exchangeRequests)
      .where(and(mine, completedIn))
      .groupBy(exchangeRequests.fromCode),
    ctx.db
      .select({
        minutes: sql<string | null>`percentile_disc(0.5) within group (order by ${minutes})`,
      })
      .from(exchangeRequests)
      .where(and(mine, completedIn)),
  ]);

  /* ── Пять разрезов из одной группировки ────────────────────────── */

  /*
   * Если два ряда группировки сошлись в один ключ — а `recipientKey`
   * склеивает пустое значение с пустой строкой, которые база различает, —
   * первой считается самая ранняя дата. Операции пустых строк в
   * реквизиты не пишут, но «новый» при таком совпадении не должен
   * зависеть от того, какой ряд база отдала последним.
   */
  const firstSubmittedAt = new Map<string, number>();
  for (const row of firstSubmitted) {
    const key = recipientKey(row);
    const first = row.first.getTime();
    firstSubmittedAt.set(key, Math.min(first, firstSubmittedAt.get(key) ?? first));
  }
  const isFresh = (row: RecipientFields): boolean => {
    const first = firstSubmittedAt.get(recipientKey(row));
    return first !== undefined && first >= window.from.getTime();
  };

  const directions = new Map<string, { row: ComboRow; bucket: Bucket }>();
  const methods = new Map<PayoutMethod | 'none', Bucket>();
  const recipients = new Map<string, { row: ComboRow; bucket: Bucket }>();
  const sources = new Map<ExchangeRequestSource | 'none', Bucket>();
  const staff = new Map<string, { row: ComboRow; bucket: Bucket }>();
  const given = new Map<string, { amount: Amount; count: number }>();
  const received = new Map<string, { amount: Amount; count: number }>();

  for (const row of combos as ComboRow[]) {
    if (row.completed > 0) {
      addMoney(given, row.fromCode, row.amount, row.completed);
      // Полученное бывает пустым, пока менеджер не назвал курс; у
      // исполненной оно есть всегда, но пустое сложилось бы в ноль.
      if (row.received !== null) addMoney(received, row.toCode, row.received, row.completed);
    }

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

    const who = row.submittedByUserId ?? 'none';
    const inStaff = staff.get(who) ?? { row, bucket: emptyBucket() };
    addTo(inStaff.bucket, row);
    staff.set(who, inStaff);
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
      lastSubmittedAt: bucket.last === null ? null : new Date(bucket.last),
      fresh: isFresh(row),
    }))
    .sort(unknownLast((one) => one.kind));
  const byRecipient = allRecipients.slice(0, RECIPIENTS_SHOWN);
  // Получатели — только названные и только те, кому в период подавали:
  // заявка без записи получателя человеком не считается, а исполненная
  // в период по давней подаче — не повод считать её получателя.
  const counted = allRecipients.filter((one) => one.kind !== null && one.submitted > 0);
  const freshCount = counted.filter((one) => one.fresh).length;

  const bySource = [...sources.entries()]
    .map(([source, bucket]) => ({
      source: source === 'none' ? null : source,
      ...sliceOf(bucket),
    }))
    .sort(unknownLast((one) => one.source));

  const byStaff = [...staff.values()]
    .map(({ row, bucket }) => ({
      userId: row.submittedByUserId,
      name: row.submittedByName,
      role: row.submittedByRole,
      ...sliceOf(bucket),
    }))
    .sort(unknownLast((one) => one.userId));

  /* ── Динамика ──────────────────────────────────────────────────── */

  const submittedBy = new Map(submittedSeries.map((row) => [row.at, row.n]));
  const recipientsBy = new Map(recipientsByStep.map((row) => [row.at, row.n]));
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
      recipients: recipientsBy.get(at) ?? 0,
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

  const load = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const row of clock) {
    const line = load[row.weekday - 1];
    if (line !== undefined && row.hour >= 0 && row.hour < 24) line[row.hour] = (line[row.hour] ?? 0) + row.n;
  }

  const codes = [...new Set([...given.keys(), ...received.keys()])].sort((a, b) => a.localeCompare(b));
  const byCurrency: MerchantCurrencySlice[] = codes.map((code) => ({
    code,
    given: given.get(code) ?? null,
    received: received.get(code) ?? null,
  }));

  const best = bestDay[0];
  const middle = medianMinutes[0]?.minutes;

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
    byStaff,
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
    load,
    recipients: {
      total: counted.length,
      fresh: freshCount,
      returning: counted.length - freshCount,
    },
    byCurrency,
    medianTicket: medianTicket
      .map((row) => ({ code: row.code, amount: Money.toAmount(row.amount) }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    records: {
      busiestStep: busiest === null ? null : { at: busiest.at, submitted: busiest.submitted },
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
      bestDay: best === undefined ? null : { at: best.at, completed: best.n },
      medianMinutes: middle === null || middle === undefined ? null : Number(middle),
    },
  };
}

/** Прибавить сумму к валюте в карте: суммы по валютам копятся порознь. */
function addMoney(
  into: Map<string, { amount: Amount; count: number }>,
  code: string,
  amount: string | null,
  count: number,
): void {
  const line = into.get(code) ?? { amount: Money.ZERO, count: 0 };
  into.set(code, {
    amount: Money.add(line.amount, Money.toAmount(amount ?? '0')),
    count: line.count + count,
  });
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
