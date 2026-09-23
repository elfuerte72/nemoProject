import { invoiceColumns, REQUIRED_INVOICE_COLUMNS, type InvoiceColumn } from './invoice-rows';

/**
 * Личная настройка списка счетов: колонки, плотность и число строк на
 * странице — «Вид таблицы» у самой таблицы.
 *
 * В куке, а не в `localStorage`, — тем же правилом, что у полей стола в
 * панели: список рисует сервер, и знать набор колонок и размер страницы
 * он должен до отрисовки. Внутри — идентификатор мерчанта: два человека
 * на одном ноутбуке не должны видеть настроек друг друга, и чужая запись
 * читается как отсутствующая.
 *
 * Своя, а не общая с панелью: таблицы у них разные, и общий модуль
 * пришлось бы параметризовать набором колонок, шириной сетки и ключом
 * владельца ради двух вызовов. Счета к тому же макет — их могут снести
 * целиком, когда станет известно, чем платит покупатель.
 *
 * Имя куки прежнее, со времён, когда в ней жили одни колонки: иначе
 * настройка, заведённая до плотности, пропала бы молча.
 */

export const INVOICE_PREFS_COOKIE = 'nemo_invoices_columns';

/** Сколько строк на странице можно выбрать. Прочее число в куке — умолчание. */
export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

export interface InvoicePrefs {
  readonly columns: readonly InvoiceColumn[];
  /** Плотная таблица: строки ниже, на экран входит больше. */
  readonly dense: boolean;
  readonly perPage: number;
}

export const DEFAULT_INVOICE_PREFS: InvoicePrefs = {
  columns: invoiceColumns,
  dense: false,
  perPage: 25,
};

export function readInvoicePrefs(
  raw: string | null | undefined,
  merchantId: string,
): InvoicePrefs {
  if (!raw) return DEFAULT_INVOICE_PREFS;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== 'object') return DEFAULT_INVOICE_PREFS;
    const record = parsed as Record<string, unknown>;
    if (record.merchantId !== merchantId) return DEFAULT_INVOICE_PREFS;

    const shown = new Set<InvoiceColumn>(invoiceColumns);
    const hidden = Array.isArray(record.hidden) ? record.hidden.map(String) : [];
    for (const one of hidden) {
      // Номер, сумму и состояние не спрятать даже испорченной кукой.
      if (
        (invoiceColumns as readonly string[]).includes(one) &&
        !(REQUIRED_INVOICE_COLUMNS as readonly string[]).includes(one)
      ) {
        shown.delete(one as InvoiceColumn);
      }
    }
    const perPage = (PER_PAGE_OPTIONS as readonly number[]).includes(record.perPage as number)
      ? (record.perPage as number)
      : DEFAULT_INVOICE_PREFS.perPage;

    return {
      columns: invoiceColumns.filter((one) => shown.has(one)),
      dense: record.dense === true,
      perPage,
    };
  } catch {
    return DEFAULT_INVOICE_PREFS;
  }
}

export function serializeInvoicePrefs(prefs: InvoicePrefs, merchantId: string): string {
  const hidden = invoiceColumns.filter((one) => !prefs.columns.includes(one));
  return encodeURIComponent(
    JSON.stringify({ merchantId, hidden, dense: prefs.dense, perPage: prefs.perPage }),
  );
}
