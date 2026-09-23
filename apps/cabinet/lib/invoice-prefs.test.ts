import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVOICE_PREFS,
  INVOICE_PREFS_COOKIE,
  PER_PAGE_OPTIONS,
  readInvoicePrefs,
  serializeInvoicePrefs,
} from './invoice-prefs';
import { invoiceColumns, REQUIRED_INVOICE_COLUMNS } from './invoice-rows';

/**
 * Личная настройка списка: колонки, плотность и число строк. Своя
 * читается, чужая и испорченная — нет. Список обязан открыться при
 * любом содержимом куки: она приходит из браузера, и отказом на мусор
 * отвечать незачем.
 */

const read = (raw: string | undefined, merchantId = 'shop') => readInvoicePrefs(raw, merchantId);

describe('настройка списка из куки', () => {
  it('без куки — все колонки, обычная плотность, двадцать пять строк', () => {
    expect(read(undefined)).toEqual(DEFAULT_INVOICE_PREFS);
    expect(read('')).toEqual(DEFAULT_INVOICE_PREFS);
    expect(DEFAULT_INVOICE_PREFS.columns).toEqual(invoiceColumns);
    expect(DEFAULT_INVOICE_PREFS.perPage).toBe(25);
    expect(DEFAULT_INVOICE_PREFS.dense).toBe(false);
  });

  it('своя настройка читается и переживает запись', () => {
    const prefs = {
      columns: invoiceColumns.filter((one) => one !== 'author'),
      dense: true,
      perPage: 50,
    };
    expect(read(serializeInvoicePrefs(prefs, 'shop'))).toEqual(prefs);
  });

  it('чужая настройка читается как отсутствующая', () => {
    const raw = serializeInvoicePrefs({ ...DEFAULT_INVOICE_PREFS, dense: true }, 'other');
    expect(read(raw)).toEqual(DEFAULT_INVOICE_PREFS);
  });

  it('порядок колонок задаёт код, а не кука', () => {
    const raw = serializeInvoicePrefs(
      { ...DEFAULT_INVOICE_PREFS, columns: [...invoiceColumns].reverse() },
      'shop',
    );
    expect(read(raw).columns).toEqual(invoiceColumns);
  });

  it('номер, сумму и состояние не спрятать даже испорченной кукой', () => {
    const raw = encodeURIComponent(
      JSON.stringify({ merchantId: 'shop', hidden: [...invoiceColumns, 'выдумка'] }),
    );
    expect(read(raw).columns).toEqual(REQUIRED_INVOICE_COLUMNS);
  });

  it('число строк — только из предложенных', () => {
    const raw = encodeURIComponent(JSON.stringify({ merchantId: 'shop', hidden: [], perPage: 7 }));
    expect(read(raw).perPage).toBe(25);
    expect(PER_PAGE_OPTIONS).toContain(25);
  });

  it('кука до «Полей» с плотностью читается: в ней были только колонки', () => {
    const raw = encodeURIComponent(JSON.stringify({ merchantId: 'shop', hidden: ['author'] }));
    expect(read(raw)).toEqual({
      columns: invoiceColumns.filter((one) => one !== 'author'),
      dense: false,
      perPage: 25,
    });
  });

  it('мусор в куке не роняет список', () => {
    expect(read('не json')).toEqual(DEFAULT_INVOICE_PREFS);
    expect(read(encodeURIComponent('"строка"'))).toEqual(DEFAULT_INVOICE_PREFS);
    expect(read(encodeURIComponent('null'))).toEqual(DEFAULT_INVOICE_PREFS);
  });

  it('имя куки прежнее: настройка, заведённая раньше, не теряется', () => {
    expect(INVOICE_PREFS_COOKIE).toBe('nemo_invoices_columns');
  });
});
