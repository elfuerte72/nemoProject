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
  /**
   * Кто подал внутри кабинета. Пусто у заявок по ключу API и у
   * поданных до появления отметки; имя по нему подставляет страница —
   * список людей мерчанта читает один владелец (тикет 17).
   */
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

/** Столько строк на странице: экран ноутбука вмещает их без второй прокрутки. */
export const REQUESTS_PAGE = 25;

/** Длиннее своих номеров не бывает, а адрес присылает кто угодно. */
export const SEARCH_MAX = 100;

/**
 * Запрос поиска из адреса. Берут его отсюда и страница, и маршрут
 * дочитывания: разойдись они, вторая страница искала бы не то, что
 * первая. Длинный обрезается, а не отвергается: это адресная строка, и
 * отказом на неё отвечать незачем.
 */
export function pickSearch(raw: string | undefined): string {
  return (raw ?? '').trim().slice(0, SEARCH_MAX);
}

/** Адрес таба. Поиск едет с ним: иначе таб сбрасывал бы найденное. */
export function tabHref(tab: RequestTab, search: string): string {
  const params = new URLSearchParams({ tab });
  if (search) params.set('q', search);
  return `/requests?${params.toString()}`;
}
