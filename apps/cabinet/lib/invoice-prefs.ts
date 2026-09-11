import { invoiceColumns, REQUIRED_INVOICE_COLUMNS, type InvoiceColumn } from './invoice-rows';

/**
 * Личная настройка колонок списка счетов.
 *
 * В куке, а не в `localStorage`, — тем же правилом, что у полей стола в
 * панели: список рисует сервер, и знать набор колонок он должен до
 * отрисовки. Внутри — идентификатор мерчанта: два человека на одном
 * ноутбуке не должны видеть настроек друг друга, и чужая запись
 * читается как отсутствующая.
 *
 * Своя, а не общая с панелью: таблицы у них разные, и общий модуль
 * пришлось бы параметризовать набором колонок, шириной сетки и ключом
 * владельца ради двух вызовов. Счета к тому же макет — их могут снести
 * целиком, когда станет известно, чем платит покупатель.
 */

export const INVOICE_PREFS_COOKIE = 'nemo_invoices_columns';

export function readInvoiceColumns(
  raw: string | null | undefined,
  merchantId: string,
): readonly InvoiceColumn[] {
  const shown = new Set<InvoiceColumn>(invoiceColumns);
  if (!raw) return invoiceColumns;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== 'object') return invoiceColumns;
    const record = parsed as Record<string, unknown>;
    if (record.merchantId !== merchantId) return invoiceColumns;
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
    return invoiceColumns.filter((one) => shown.has(one));
  } catch {
    return invoiceColumns;
  }
}

export function serializeInvoiceColumns(
  shown: readonly InvoiceColumn[],
  merchantId: string,
): string {
  const hidden = invoiceColumns.filter((one) => !shown.includes(one));
  return encodeURIComponent(JSON.stringify({ merchantId, hidden }));
}
