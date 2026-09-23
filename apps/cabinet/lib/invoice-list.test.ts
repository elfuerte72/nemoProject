import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import {
  INVOICE_EXPORT_COLUMNS,
  INVOICE_TAB_LABELS,
  dailySeries,
  invoiceCell,
  invoiceColumns,
  invoiceMarks,
  invoiceStatuses,
  invoiceSummary,
  narrowInvoices,
  pageOf,
  refundedSoFar,
  type MockInvoice,
  type MockRefund,
} from './invoice-rows';
import { makeInvoice } from './pos';
import { demoSet } from './pos/demo';
import { paidByHand, paidByProvider, providerState, settleRefunds } from './pos/lifecycle';

/**
 * Список счетов по образцу Love&Pay: «Возвращён» как состояние, плитки
 * с возвратами и конверсией, период, «только мои» и страницы. Правила
 * те же, что у остального макета: валюты не складываются, возврат
 * считается по суммам самого счёта.
 */

const at = new Date('2026-09-11T10:00:00Z');

const invoice = (over: Partial<MockInvoice> = {}): MockInvoice => ({
  ...makeInvoice({
    number: '2026-09-11-001',
    author: 'Оплатишка',
    authorId: 'u1',
    code: 'THB',
    amount: Money.toAmount('2000'),
    payCode: 'RUB',
    payAmount: Money.toAmount('5600'),
    rate: Money.toAmount('0.357'),
    markupBps: 0,
    kycRequired: false,
    at,
    expiresAt: null,
  }),
  ...over,
});

const refund = (over: Partial<MockRefund> = {}): MockRefund => ({
  id: 'r',
  invoiceId: 'i',
  invoiceNumber: '2026-09-11-001',
  code: 'THB',
  amount: Money.toAmount('500'),
  retained: null,
  reason: 'причина',
  status: 'done',
  createdAt: at.toISOString(),
  doneAt: at.toISOString(),
  provider: 'imitation',
  demo: false,
  ...over,
});

describe('состояние «Возвращён»', () => {
  it('стоит в ряду состояний и в табах словом образца', () => {
    expect(invoiceStatuses).toContain('refunded');
    expect(INVOICE_TAB_LABELS.refunded).toBe('Возвращены');
    expect(INVOICE_TAB_LABELS.issued).toBe('Ожидают');
  });

  it('счёт, возвращённый целиком и исполненный, становится возвращённым', () => {
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    const back = settleRefunds(one, [refund({ amount: Money.toAmount('2000') })], at);
    expect(back.status).toBe('refunded');
    expect(back.events.at(-1)?.what).toMatch(/возвращены/u);
  });

  it('частичный возврат оставляет счёт оплаченным', () => {
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    expect(settleRefunds(one, [refund({})], at)).toBe(one);
  });

  it('пока возврат не исполнен, деньги не считаются вернувшимися', () => {
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    const pending = refund({ amount: Money.toAmount('2000'), status: 'approved', doneAt: null });
    expect(settleRefunds(one, [pending], at)).toBe(one);
    // Две части, обе исполнены, — вернули целиком.
    const halves = [
      refund({ id: 'a', amount: Money.toAmount('1500') }),
      refund({ id: 'b', amount: Money.toAmount('500') }),
    ];
    expect(settleRefunds(one, halves, at).status).toBe('refunded');
  });

  it('частичный возврат виден отметкой в строке', () => {
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    expect(invoiceMarks(one, [refund({})])).toContain('частичный возврат');
    expect(invoiceMarks(one, [])).toEqual([]);
    expect(invoiceMarks({ ...one, demo: true, kycRequired: true }, [])).toEqual([
      'пример',
      'верификация',
    ]);
    // Отклонённый возврат ничего не вернул.
    expect(invoiceMarks(one, [refund({ status: 'rejected' })])).toEqual([]);
    // Возврат на всю сумму, ещё не исполненный, — не частичный: счёт
    // оплачен, пока банк не отдал деньги, но отметка говорит, что ждёт.
    const whole = refund({ amount: Money.toAmount('2000'), status: 'approved', doneAt: null });
    expect(invoiceMarks(one, [whole])).toEqual(['возврат ждёт исполнения']);
    expect(refundedSoFar(one, [refund({}), refund({ status: 'rejected' })])).toBe('500');
  });
});

describe('платёж у провайдера', () => {
  it('оплата мимо сервиса не приписывается банку', () => {
    const open = invoice();
    expect(providerState(open)).toBe('QR создан');
    expect(providerState(paidByProvider(open, { at, providerTitle: 'Имитация' }))).toBe('Завершён');
    expect(providerState(paidByHand(open, at))).toMatch(/мимо/u);
  });
});

describe('примеры', () => {
  it('показывают и частичный возврат, и возвращённый целиком счёт', () => {
    const set = demoSet(at);
    expect(set.invoices.filter((one) => one.status === 'refunded')).toHaveLength(1);
    const partial = set.invoices.filter((one) =>
      invoiceMarks(one, set.refunds).includes('частичный возврат'),
    );
    expect(partial).toHaveLength(1);
  });
});

describe('плитки над списком', () => {
  const rows = [
    { ...invoice({ status: 'paid' }), id: 'i' },
    invoice({ status: 'paid', payAmount: Money.toAmount('1000'), amount: Money.toAmount('350') }),
    invoice({ status: 'issued', payAmount: Money.toAmount('700') }),
    invoice({ status: 'expired', payAmount: Money.toAmount('300') }),
  ];

  it('считает всё, ждущее, оплаченное, возвраты и чистый оборот в выбранной валюте', () => {
    const summary = invoiceSummary(rows, [refund({})], 'RUB');
    expect(summary.count).toBe(4);
    expect(summary.sum).toBe('7600');
    expect(summary.pending).toBe(1);
    expect(summary.pendingSum).toBe('700');
    expect(summary.paid).toBe(2);
    expect(summary.paidSum).toBe('6600');
    // 500 THB из 2000 — четверть счёта, то есть 1400 из 5600 рублей:
    // по суммам, записанным в сам счёт.
    expect(summary.refunded).toBe('1400');
    expect(summary.net).toBe('5200');
    expect(summary.conversion).toBe(50);
  });

  it('возвращённый целиком счёт остаётся в оплаченных и весь уходит в возвраты', () => {
    const back = [{ ...invoice({ status: 'refunded' }), id: 'i' }];
    const summary = invoiceSummary(back, [refund({ amount: Money.toAmount('2000') })], 'RUB');
    expect(summary.paid).toBe(1);
    expect(summary.refunded).toBe('5600');
    expect(Money.isZero(summary.net)).toBe(true);
  });

  it('валюты не складываются: чужая валюта в сумму не попадает', () => {
    const mixed = [
      invoice({ status: 'paid' }),
      invoice({ status: 'paid', code: 'CNY', payCode: 'USDT', payAmount: Money.toAmount('70') }),
    ];
    expect(invoiceSummary(mixed, [], 'RUB').paidSum).toBe('5600');
    expect(invoiceSummary(mixed, [], 'THB').paidSum).toBe('2000');
    expect(invoiceSummary(mixed, [], 'RUB').paid).toBe(2);
  });

  it('возврат, пересчитанный долей счёта, округлён до сотых', () => {
    // 1400 из 4201 THB при 11 352 RUB — это 3783,0992… рубля: дробь
    // без конца, и на плитке она читалась как «−3783,099262080457… RUB».
    const odd = [
      { ...invoice({ status: 'paid', amount: Money.toAmount('4201'), payAmount: Money.toAmount('11352') }), id: 'i' },
    ];
    const summary = invoiceSummary(odd, [refund({ amount: Money.toAmount('1400') })], 'RUB');
    expect(summary.refunded).toBe('3783.1');
    expect(summary.net).toBe('7568.9');
  });

  it('счёт, возвращённый частями целиком, не оставляет копейки в обороте', () => {
    // Три возврата по 300 THB из 900 THB за 2500 RUB: каждая треть —
    // 833,333… рубля, и округлённые порознь они давали 2499,99.
    const whole = [
      { ...invoice({ status: 'refunded', amount: Money.toAmount('900'), payAmount: Money.toAmount('2500') }), id: 'i' },
    ];
    const thirds = ['a', 'b', 'c'].map((id) => refund({ id, amount: Money.toAmount('300') }));
    const summary = invoiceSummary(whole, thirds, 'RUB');
    expect(summary.refunded).toBe('2500');
    expect(Money.isZero(summary.net)).toBe(true);
  });

  it('без счетов конверсии нет, а не ноль процентов', () => {
    expect(invoiceSummary([], [], 'RUB').conversion).toBeNull();
  });
});

describe('отбор списка', () => {
  const rows = [
    invoice({ number: '2026-09-01-001', createdAt: '2026-09-01T10:00:00.000Z' }),
    invoice({ number: '2026-09-10-001', createdAt: '2026-09-10T10:00:00.000Z', authorId: 'u2' }),
    invoice({ number: '2026-09-11-001', createdAt: '2026-09-11T10:00:00.000Z', authorId: null }),
  ];

  it('период по дате создания, верхняя граница не входит', () => {
    const found = narrowInvoices(rows, {
      from: new Date('2026-09-10T00:00:00Z'),
      to: new Date('2026-09-11T10:00:00Z'),
    });
    expect(found.map((one) => one.number)).toEqual(['2026-09-10-001']);
  });

  it('«только мои» — по тому, кто нажал, а не по имени', () => {
    expect(narrowInvoices(rows, { authorId: 'u1' }).map((one) => one.number)).toEqual([
      '2026-09-01-001',
    ]);
    // Без отбора — вся команда, и примеры без автора тоже.
    expect(narrowInvoices(rows, {})).toHaveLength(3);
  });

  it('поиск складывается с остальным отбором', () => {
    expect(narrowInvoices(rows, { query: '09-1', authorId: 'u2' })).toHaveLength(1);
  });
});

describe('страницы', () => {
  const rows = Array.from({ length: 55 }, (_, index) => index);

  it('называет «с какой по какую из скольких»', () => {
    expect(pageOf(rows, 1, 25)).toMatchObject({ page: 1, pages: 3, first: 1, last: 25, total: 55 });
    expect(pageOf(rows, 3, 25)).toMatchObject({ first: 51, last: 55 });
    expect(pageOf(rows, 3, 25).rows).toHaveLength(5);
  });

  it('страница за краем — последняя, а не пустая', () => {
    expect(pageOf(rows, 9, 25).page).toBe(3);
    expect(pageOf(rows, 0, 25).page).toBe(1);
    expect(pageOf(rows, Number.NaN, 25).page).toBe(1);
  });

  it('пустой список — одна страница без строк', () => {
    expect(pageOf([], 1, 25)).toMatchObject({ page: 1, pages: 1, first: 0, last: 0, total: 0 });
  });
});

describe('ход по дням для плитки', () => {
  it('раскладывает события по суткам отрезка, лишнее мимо', () => {
    const series = dailySeries(
      ['2026-09-01T05:00:00Z', '2026-09-01T23:00:00Z', '2026-09-03T01:00:00Z', '2026-09-05T01:00:00Z'],
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-04T00:00:00Z'),
    );
    expect(series).toEqual([2, 0, 1]);
  });
});

describe('колонки', () => {
  it('под датой создания — когда оплачен', () => {
    const one = invoice({ status: 'paid', paidAt: '2026-09-12T09:00:00.000Z' });
    expect(invoiceCell(one, 'created').meta).toBe('оплачен 2026-09-12');
    expect(invoiceCell(invoice(), 'created').meta).toBeUndefined();
  });

  it('отметки строки идут под состоянием', () => {
    expect(invoiceCell(invoice(), 'status', 0, ['частичный возврат']).meta).toBe(
      'частичный возврат',
    );
  });

  it('кнопки в файл не выгружаются', () => {
    expect(invoiceColumns).toContain('open');
    expect(INVOICE_EXPORT_COLUMNS).not.toContain('open');
  });
});
