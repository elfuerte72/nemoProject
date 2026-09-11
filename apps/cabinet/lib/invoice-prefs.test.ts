import { describe, expect, it } from 'vitest';
import { INVOICE_PREFS_COOKIE, readInvoiceColumns, serializeInvoiceColumns } from './invoice-prefs';
import { invoiceColumns, REQUIRED_INVOICE_COLUMNS } from './invoice-rows';

/**
 * Личный набор колонок: своя настройка читается, чужая и испорченная —
 * нет. Список обязан открыться при любом содержимом куки: она приходит
 * из браузера, и отказом на мусор отвечать незачем.
 */

describe('набор колонок из куки', () => {
  it('без куки показываются все колонки', () => {
    expect(readInvoiceColumns(undefined, 'shop')).toEqual(invoiceColumns);
    expect(readInvoiceColumns('', 'shop')).toEqual(invoiceColumns);
  });

  it('своя настройка читается и переживает запись', () => {
    const shown = invoiceColumns.filter((one) => one !== 'author');
    const raw = serializeInvoiceColumns(shown, 'shop');
    expect(readInvoiceColumns(raw, 'shop')).toEqual(shown);
  });

  it('чужая настройка читается как отсутствующая', () => {
    const raw = serializeInvoiceColumns(
      invoiceColumns.filter((one) => one !== 'author'),
      'other',
    );
    expect(readInvoiceColumns(raw, 'shop')).toEqual(invoiceColumns);
  });

  it('порядок колонок задаёт код, а не кука', () => {
    const raw = serializeInvoiceColumns([...invoiceColumns].reverse(), 'shop');
    expect(readInvoiceColumns(raw, 'shop')).toEqual(invoiceColumns);
  });

  it('номер, сумму и состояние не спрятать даже испорченной кукой', () => {
    const raw = encodeURIComponent(
      JSON.stringify({ merchantId: 'shop', hidden: [...invoiceColumns, 'выдумка'] }),
    );
    expect(readInvoiceColumns(raw, 'shop')).toEqual(REQUIRED_INVOICE_COLUMNS);
  });

  it('мусор в куке не роняет список', () => {
    expect(readInvoiceColumns('не json', 'shop')).toEqual(invoiceColumns);
    expect(readInvoiceColumns(encodeURIComponent('"строка"'), 'shop')).toEqual(invoiceColumns);
    expect(readInvoiceColumns(encodeURIComponent('null'), 'shop')).toEqual(invoiceColumns);
  });

  it('имя куки — одно на страницу и на переключатель', () => {
    expect(INVOICE_PREFS_COOKIE).toBe('nemo_invoices_columns');
  });
});
