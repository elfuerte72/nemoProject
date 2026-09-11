import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { Money, type Quote } from '@nemo/types';
import { formatMoney } from '@nemo/ui/format';
import {
  INVOICE_COLUMN_LABELS,
  invoiceCell,
  invoiceColumns,
  invoiceCurrencies,
  invoiceMoneyLines,
  invoiceTotal,
  refundCell,
  refundColumns,
  searchInvoices,
  type MockInvoice,
} from './invoice-rows';
import { buyerPays, makeInvoice, nextNumber, posSides } from './pos';
import { addInvoice, forgetMock, listInvoices } from './mock/store';
import { INVOICES_HOW_TO, POS_HOW_TO, PREVIEW_NOTE, REFUNDS_HOW_TO } from './pos-texts';

/**
 * Счета и возвраты — макет, но правила у него те же: колонки в одном
 * месте, валюты не складываются, сумма к оплате округляется вверх, а
 * выборка мерчанта не видит чужого.
 */

const at = new Date('2026-09-11T10:00:00Z');

const invoice = (over: Partial<MockInvoice> = {}): MockInvoice => ({
  ...makeInvoice({
    number: '2026-09-11-001',
    purpose: 'Маникюр',
    buyer: 'Анна',
    author: 'Оплатишка',
    code: 'THB',
    amount: Money.toAmount('2000'),
    payCode: 'RUB',
    payAmount: Money.toAmount('5600'),
    rate: Money.toAmount('2.8'),
    at,
  }),
  ...over,
});

describe('сумма к оплате', () => {
  it('округляется вверх до целой единицы', () => {
    expect(buyerPays(Money.toAmount('5599.01'))).toBe('5600');
    expect(buyerPays(Money.toAmount('5600'))).toBe('5600');
    // Копейку у стойки не отдают, а вниз её терял бы мерчант.
    expect(buyerPays(Money.toAmount('0.4'))).toBe('1');
  });

  it('считает встречную сторону и округляет счёт вверх в обе стороны', () => {
    // Курс «1 RUB = 0,4 THB»: сторона считается той же арифметикой,
    // что у формы заявки и у ядра.
    const quote: Quote = { rate: Money.toAmount('0.4'), payoutDecimals: 2 };

    // Назвали рубли — получили баты.
    expect(posSides(Money.toAmount('5000'), 'pay', quote)).toEqual({
      buy: '2000',
      pay: '5000',
    });

    // Назвали баты — счёт вышел вверх до рубля.
    const back = posSides(Money.toAmount('2000.5'), 'buy', quote);
    expect(back.buy).toBe('2000.5');
    expect(back.pay).toBe('5002');
  });

  it('без курса считает только набранное', () => {
    expect(posSides(Money.toAmount('5000'), 'pay', null)).toEqual({ buy: null, pay: '5000' });
    expect(posSides(null, 'buy', null)).toEqual({ buy: null, pay: null });
  });
});

describe('колонки списка счетов', () => {
  it('шапка и строка берут набор из одного места', () => {
    const one = invoice();
    const header = invoiceColumns.map((column) => INVOICE_COLUMN_LABELS[column]);
    const row = invoiceColumns.map((column) => invoiceCell(one, column));
    expect(row).toHaveLength(header.length);
    expect(header.every((label) => label.length > 0)).toBe(true);
    expect(row.every((cell) => cell.text.length > 0)).toBe(true);
  });

  it('сумма показывается с эквивалентом по курсу, записанному в счёт', () => {
    const cell = invoiceCell(invoice(), 'amount');
    expect(cell.text).toBe(formatMoney(Money.toAmount('2000'), 'THB'));
    expect(cell.meta).toContain(formatMoney(Money.toAmount('5600'), 'RUB'));
    expect(cell.meta).toContain('2,8');
  });

  it('у возврата целиком удержанного нет, а не ноль', () => {
    const cell = refundCell(
      {
        id: 'r1',
        invoiceId: 'i1',
        invoiceNumber: '2026-09-11-001',
        code: 'THB',
        amount: Money.toAmount('2000'),
        retained: null,
        reason: 'Отменили запись',
        status: 'pending',
        createdAt: at.toISOString(),
      },
      'retained',
    );
    expect(cell.text).toBe('—');
    expect(cell.meta).toBe('возврат целиком');
    expect(refundColumns).toContain('retained');
  });
});

describe('числа над списком', () => {
  it('валюта оплаты складывается по всем счетам, валюта покупателя — только по своим', () => {
    const rows = [
      invoice(),
      invoice({
        code: 'CNY',
        amount: Money.toAmount('500'),
        payAmount: Money.toAmount('6600'),
        rate: Money.toAmount('13.2'),
      }),
    ];

    // Рубли — точная сумма: у каждого счёта записан свой курс.
    expect(invoiceTotal(rows, 'RUB')).toEqual({ amount: '12200', count: 2 });
    // Баты — только по батовым счетам: свести их с юанями нечем.
    expect(invoiceTotal(rows, 'THB')).toEqual({ amount: '2000', count: 1 });
    expect(invoiceCurrencies(rows)).toEqual(['CNY', 'RUB', 'THB']);
    expect(invoiceMoneyLines(rows)).toEqual([
      { code: 'CNY', amount: '500', count: 1 },
      { code: 'THB', amount: '2000', count: 1 },
    ]);
  });

  it('поиск сужает список, а не прячет строки', () => {
    const rows = [invoice(), invoice({ buyer: 'Пётр', purpose: 'Педикюр' })];
    expect(searchInvoices(rows, 'пётр')).toHaveLength(1);
    expect(searchInvoices(rows, 'маникюр')).toHaveLength(1);
    expect(searchInvoices(rows, '  ')).toHaveLength(2);
    expect(searchInvoices(rows, 'ничего')).toHaveLength(0);
  });

  it('номер счёта продолжает день, а не начинается заново', () => {
    const first = invoice({ number: nextNumber([], at) });
    expect(first.number).toBe('2026-09-11-001');
    expect(nextNumber([first], at)).toBe('2026-09-11-002');
    // Другой день начинается с первого.
    expect(nextNumber([first], new Date('2026-09-12T09:00:00Z'))).toBe('2026-09-12-001');
  });
});

describe('тексты кассы, счетов и возвратов набраны человеком', () => {
  it.each([
    ['Касса', POS_HOW_TO],
    ['Счета', INVOICES_HOW_TO],
    ['Возвраты', REFUNDS_HOW_TO],
  ] as const)('подсказка «%s»', (_name, items) => {
    for (const item of items) {
      expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
    }
  });

  it('предупреждение о макете говорит про деньги прямо', () => {
    expect(slopComplaints(PREVIEW_NOTE)).toEqual([]);
    expect(PREVIEW_NOTE).toMatch(/денег/u);
  });
});

describe('память макета', () => {
  it('чужих счетов мерчант не видит', () => {
    forgetMock('shop');
    forgetMock('other');
    addInvoice('shop', invoice());
    addInvoice('other', invoice({ buyer: 'Чужой' }));

    expect(listInvoices('shop')).toHaveLength(1);
    expect(listInvoices('shop')[0]?.buyer).toBe('Анна');
    expect(listInvoices('nobody')).toEqual([]);
  });
});
