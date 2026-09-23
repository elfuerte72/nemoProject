import { dayOf, resolvePeriod, type Period, type PeriodKey } from '@nemo/ui/period';
import type { ExchangeRequestView } from '@nemo/core';
import type { ExchangeKind, ExchangeRequestStatus } from '@nemo/types';

/**
 * Строка заявки для экрана.
 *
 * Отдельный вид, а не сам `ExchangeRequestView`: список дочитывается в
 * браузере, а через границу клиентского компонента `Date` не переезжает
 * — только строки. Заодно здесь остаётся ровно то, что в строке видно:
 * реквизитам и внутренним полям в разметке делать нечего.
 */
export interface RequestRow {
  readonly id: string;
  readonly kind: ExchangeKind;
  readonly fromCode: string;
  readonly toCode: string;
  readonly fromAmount: string;
  readonly toAmount: string | null;
  readonly status: ExchangeRequestStatus;
  readonly reference: string | null;
  /** ISO-строка: она же курсор дочитывания вместе с идентификатором. */
  readonly createdAt: string;
}

export function toRequestRow(request: ExchangeRequestView): RequestRow {
  return {
    id: request.id,
    kind: request.kind,
    fromCode: request.fromCode,
    toCode: request.toCode,
    fromAmount: request.fromAmount,
    toAmount: request.toAmount,
    status: request.status,
    reference: request.reference,
    createdAt: request.createdAt.toISOString(),
  };
}

/**
 * Какие состояния показывает таб. Табы — это вопросы, которые мерчант
 * задаёт своим заявкам: «что не закончено», «что вышло», «что не
 * вышло». Набор живёт здесь, потому что его читают и страница, и
 * маршрут дочитывания, и разойтись они не должны.
 */
export const REQUEST_TABS = ['open', 'completed', 'cancelled', 'all'] as const;
export type RequestTab = (typeof REQUEST_TABS)[number];

export const TAB_LABELS: Record<RequestTab, string> = {
  open: 'В работе',
  completed: 'Исполнены',
  cancelled: 'Отменены',
  all: 'Все',
};

/**
 * Состояния, при которых заявка ещё не закрыта: они и есть работа.
 * Отсюда их берут и таб «В работе», и счётчик в меню — списком в двух
 * местах они разошлись бы при первом же новом состоянии, и счётчик стал
 * бы спорить с табом, на который показывает.
 */
export const OPEN_STATUSES: readonly ExchangeRequestStatus[] = [
  'new',
  'in_progress',
  'rate_confirmed',
  'payment_received',
];

const TAB_STATUSES: Record<RequestTab, readonly ExchangeRequestStatus[] | undefined> = {
  open: OPEN_STATUSES,
  completed: ['completed'],
  cancelled: ['cancelled'],
  all: undefined,
};

export function statusesOf(tab: RequestTab): readonly ExchangeRequestStatus[] | undefined {
  return TAB_STATUSES[tab];
}

export function pickTab(value: string | undefined): RequestTab {
  return REQUEST_TABS.find((one) => one === value) ?? 'open';
}

/**
 * Строка под числом плитки — то, что делает число честным: что именно
 * посчитано. При поиске её место занимает «из найденных».
 */
export const TAB_NOTES: Record<RequestTab, string> = {
  open: 'ждут менеджера или оплаты',
  completed: 'деньги отправлены получателю',
  cancelled: 'вами, менеджером или по сроку',
  all: 'за всё время',
};

/**
 * Тон плитки — по правилу плиток и пилюль: медовое ждёт человека,
 * зелёное готово, красное — отказ. «Все» никого не зовёт.
 */
export const TAB_TONES: Record<RequestTab, 'plain' | 'wait' | 'up' | 'down'> = {
  open: 'wait',
  completed: 'up',
  cancelled: 'down',
  all: 'plain',
};

/** Столько строк на странице: экран ноутбука вмещает их без второй прокрутки. */
export const REQUESTS_PAGE = 25;

/**
 * Столько знаков у самого длинного своего номера (`MAX_MERCHANT_FIELD` в
 * ядре): вставленный целиком, он ищется целиком. Длиннее незачем, а
 * адрес присылает кто угодно.
 */
export const SEARCH_MAX = 200;

/**
 * Запрос поиска из адреса. Берут его отсюда и страница, и маршрут
 * дочитывания: разойдись они, вторая страница искала бы не то, что
 * первая. Длинный обрезается, а не отвергается: это адресная строка, и
 * отказом на неё отвечать незачем.
 */
export function pickSearch(raw: string | undefined): string {
  /*
   * Управляющие знаки вычищаются до обрезки краёв. Нулевой байт база в
   * текстовом параметре отвергает ошибкой, и `/requests?q=%00` отвечал
   * пятисотым — а адресной строке отказом не отвечают. Остальным
   * (табуляция, перевод строки) в номере заказа тоже делать нечего.
   */
  // eslint-disable-next-line no-control-regex
  return (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, SEARCH_MAX);
}

/**
 * Адрес таба. Поиск и период едут с ним: иначе плитка сбрасывала бы и
 * найденное, и выбранные даты.
 */
export function tabHref(
  tab: RequestTab,
  search: string,
  period: Readonly<Record<string, string>> = {},
): string {
  const params = new URLSearchParams({ tab });
  if (search) params.set('q', search);
  for (const [key, value] of Object.entries(period)) params.set(key, value);
  return `/requests?${params.toString()}`;
}

/* ── Период ──────────────────────────────────────────────────────── */

/**
 * Какие периоды предлагает список: неделя, месяц, три месяца — и свой,
 * с числа по число. Названы теми же словами, что на обзоре («7 дней»,
 * «30 дней», «90 дней»): там те же выборки стоят рядом с теми же
 * числами, и «месяц» здесь при «30 днях» там читался бы как календарный
 * — то есть как другой отрезок.
 */
export const LIST_PERIOD_KEYS: readonly PeriodKey[] = ['7d', '30d', '90d'];

export interface ListPeriod {
  readonly period: Period;
  /** Те же границы параметрами адреса — чтобы плитки и поиск несли период с собой. */
  readonly query: Readonly<Record<string, string>>;
  /**
   * Первый и последний день периода — для полей «с» и «по». Названы и у
   * быстрого периода: «7 дней» без чисел оставляет гадать, входит ли
   * сегодня, а свой период удобнее начинать с готового отрезка.
   */
  readonly days: { readonly from: string; readonly to: string };
}

/**
 * Период списка из адреса — или его отсутствие.
 *
 * Отличие от обзора одно, и оно главное: у списка периода может не быть
 * вовсе. Обзор без периода не посчитать, и там незнакомый адрес значит
 * «тридцать дней» (`resolvePeriod`). А список без периода — это все
 * заявки, и молча сузить его до месяца значило бы спрятать от мерчанта
 * заявку, за которой он пришёл. Поэтому всё, чего список не узнал, —
 * «всё время»; сами же границы считает общее правило, и день у него тот
 * же, что на обзоре.
 */
export function pickPeriod(
  params: {
    readonly period?: string | undefined;
    readonly from?: string | undefined;
    readonly to?: string | undefined;
  },
  now: Date,
  offsetMinutes: number,
  /** Чипы экрана: у счетов есть «Сегодня» — их смотрят за смену. */
  keys: readonly PeriodKey[] = LIST_PERIOD_KEYS,
): ListPeriod | null {
  const asked = params.period;
  const known = asked === 'custom' || keys.includes(asked as PeriodKey);
  if (!asked || !known) return null;

  const period = resolvePeriod(params, now, offsetMinutes);
  // Общее правило на битые даты отвечает «тридцать дней» — для списка
  // это и есть молчаливое сужение: узнаётся оно по сменившемуся ключу.
  if (period.key !== asked) return null;

  const lastDay = new Date(period.to.getTime() - 1);
  const days = { from: dayOf(period.from, offsetMinutes), to: dayOf(lastDay, offsetMinutes) };
  // В адрес дни идут только у своего периода: «7 дней» завтра — уже
  // другие числа, и ссылка с ними перестала бы значить «последняя неделя».
  return {
    period,
    days,
    query: period.key === 'custom' ? { period: 'custom', ...days } : { period: period.key },
  };
}

/**
 * Период — в границы отбора ядра. У периода верхняя граница не входит
 * (`[с, по)`), у отбора своих заявок — входит; перевод жил строкой в
 * выгрузке CSV, а теперь нужен ещё странице и дочитыванию, и трёх копий
 * «минус миллисекунда» быть не должно.
 */
export function boundsOf(picked: Pick<ListPeriod, 'period'> | null): { from?: Date; to?: Date } {
  if (!picked) return {};
  return { from: picked.period.from, to: new Date(picked.period.to.getTime() - 1) };
}
