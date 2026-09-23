import type { PeriodKey } from '@nemo/ui/period';
import {
  invoiceStatuses,
  narrowInvoices,
  type InvoiceStatus,
  type MockInvoice,
} from './invoice-rows';
import { pickPeriod, type ListPeriod } from './request-rows';

/**
 * Отбор списка счетов из адреса — один на страницу и на выгрузку.
 *
 * Ссылка «Выгрузить» несёт адрес страницы, и файл обязан отобрать ровно
 * то, что было на экране. Два разбора одного адреса расходятся при первой
 * правке: добавленный на странице чип «90 дней» маршрут выгрузки прочёл
 * бы как «всё время», и файл молча разошёлся бы с экраном.
 */

/** Чипы периода: смена, неделя, месяц — и «за всё время» первым. */
export const INVOICE_PERIOD_KEYS: readonly PeriodKey[] = ['today', '7d', '30d'];

export interface InvoiceFilter {
  readonly query: string;
  /** Таб. Пусто — все состояния. */
  readonly status: InvoiceStatus | undefined;
  /** «Счета всей команды» выключены: только счета того, кто смотрит. */
  readonly mine: boolean;
  /** Период. Пусто — всё время. */
  readonly picked: ListPeriod | null;
}

/**
 * Отбор из параметров адреса. Незнакомое — как отсутствующее, а не
 * отказ: параметр приходит из адресной строки, и файл с одной шапкой на
 * опечатку читался бы как «счетов не было».
 */
export function readInvoiceFilter(
  get: (key: string) => string | undefined,
  now: Date,
  offsetMinutes: number,
): InvoiceFilter {
  const tab = get('tab');
  return {
    query: get('q')?.trim() ?? '',
    status: (invoiceStatuses as readonly string[]).includes(tab ?? '')
      ? (tab as InvoiceStatus)
      : undefined,
    mine: get('mine') === '1',
    picked: pickPeriod(
      { period: get('period'), from: get('from'), to: get('to') },
      now,
      offsetMinutes,
      INVOICE_PERIOD_KEYS,
    ),
  };
}

/** Тот же отбор параметрами адреса — для ссылок, чипов и выгрузки. */
export function invoiceFilterParams(filter: InvoiceFilter): Record<string, string> {
  return {
    ...(filter.query ? { q: filter.query } : {}),
    ...(filter.status ? { tab: filter.status } : {}),
    ...(filter.mine ? { mine: '1' } : {}),
    ...(filter.picked?.query ?? {}),
  };
}

/**
 * Найденное и показанное. Плитки и счётчики табов считают найденное —
 * отбор без таба, — а строки идут с табом: таб выбирает строки, а не
 * меняет итоги.
 */
export function applyInvoiceFilter(
  invoices: readonly MockInvoice[],
  filter: InvoiceFilter,
  userId: string | null,
): { readonly found: readonly MockInvoice[]; readonly rows: readonly MockInvoice[] } {
  const found = narrowInvoices(invoices, {
    query: filter.query,
    from: filter.picked?.period.from,
    to: filter.picked?.period.to,
    authorId: filter.mine ? (userId ?? undefined) : undefined,
  });
  const rows = filter.status === undefined ? found : found.filter((one) => one.status === filter.status);
  return { found, rows };
}
