import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import {
  INVOICE_EXPORT_COLUMNS,
  INVOICE_STATUS_LABELS,
  currencyBreakdown,
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
import {
  addInvoice,
  addRefund,
  forgetMock,
  listInvoices,
  removeInvoices,
  replaceInvoice as replaceInvoiceForTest,
  replaceRefund,
} from './mock/store';
import { demoSet } from './pos/demo';
import {
  bulkTargets,
  paidByHand,
  paidByProvider,
  providerState,
  settleRefunds,
} from './pos/lifecycle';
import { INVOICE_OPEN_LABEL, INVOICE_TILE_LABELS } from './pos-texts';
import { applyInvoiceFilter, invoiceFilterParams, readInvoiceFilter } from './invoice-filter';

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
  it('стоит в ряду состояний', () => {
    expect(invoiceStatuses).toContain('refunded');
    expect(INVOICE_STATUS_LABELS.refunded).toBe('Возвращён');
  });

  it('счёт, возвращённый целиком и исполненный, становится возвращённым в час исполнения', () => {
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    const done = '2026-09-12T08:00:00.000Z';
    const back = settleRefunds(one, [refund({ amount: Money.toAmount('2000'), doneAt: done })]);
    expect(back.status).toBe('refunded');
    expect(back.events.at(-1)).toEqual({ at: done, what: 'Деньги возвращены покупателю целиком' });
  });

  it('частичный возврат оставляет счёт оплаченным', () => {
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    expect(settleRefunds(one, [refund({})])).toBe(one);
  });

  it('пока возврат не исполнен, деньги не считаются вернувшимися', () => {
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    const pending = refund({ amount: Money.toAmount('2000'), status: 'approved', doneAt: null });
    expect(settleRefunds(one, [pending])).toBe(one);
    // Две части, обе исполнены, — вернули целиком.
    const halves = [
      refund({ id: 'a', amount: Money.toAmount('1500') }),
      refund({ id: 'b', amount: Money.toAmount('500') }),
    ];
    expect(settleRefunds(one, halves).status).toBe('refunded');
  });

  it('считается при чтении: исполненный позже возврат переводит счёт сам', () => {
    // Возврат, принятый банком к исполнению, исполняется потом — и
    // счёт обязан стать возвращённым тогда, а не застрять оплаченным
    // из-за того, что в момент заявки деньги ещё не ушли.
    forgetMock('settle');
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    addInvoice('settle', one);
    addRefund('settle', refund({ amount: Money.toAmount('2000'), status: 'approved', doneAt: null }));
    expect(listInvoices('settle')[0]?.status).toBe('paid');
    const done = '2026-09-12T08:00:00.000Z';
    replaceRefund(
      'settle',
      refund({ amount: Money.toAmount('2000'), status: 'done', doneAt: done }),
    );
    const settled = listInvoices('settle')[0];
    expect(settled?.status).toBe('refunded');
    expect(settled?.events.at(-1)?.at).toBe(done);
    forgetMock('settle');
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
    const summary = invoiceSummary(rows, [refund({})], 'RUB', 0);
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
    const summary = invoiceSummary(back, [refund({ amount: Money.toAmount('2000') })], 'RUB', 0);
    expect(summary.paid).toBe(1);
    expect(summary.refunded).toBe('5600');
    expect(Money.isZero(summary.net)).toBe(true);
  });

  it('валюты не складываются: чужая валюта в сумму не попадает', () => {
    const mixed = [
      invoice({ status: 'paid' }),
      invoice({ status: 'paid', code: 'CNY', payCode: 'USDT', payAmount: Money.toAmount('70') }),
    ];
    expect(invoiceSummary(mixed, [], 'RUB', 0).paidSum).toBe('5600');
    expect(invoiceSummary(mixed, [], 'THB', 2).paidSum).toBe('2000');
    expect(invoiceSummary(mixed, [], 'RUB', 0).paid).toBe(2);
  });

  it('возврат, пересчитанный долей счёта, ровняется знаком валюты оплаты', () => {
    // 1400 из 4201 THB при 11 352 RUB — это 3783,0992… рубля: дробь
    // без конца. Рубль в счетах целый (`payRounding`), и возврат рядом
    // с ним ровняется так же — к ближайшему: «−3 783,1» среди целых
    // рублей читалось бы вторым правилом округления на одном экране.
    const odd = [
      { ...invoice({ status: 'paid', amount: Money.toAmount('4201'), payAmount: Money.toAmount('11352') }), id: 'i' },
    ];
    const back = [refund({ amount: Money.toAmount('1400') })];
    const rubles = invoiceSummary(odd, back, 'RUB', 0);
    expect(rubles.refunded).toBe('3783');
    expect(rubles.net).toBe('7569');
    // У монеты знаков больше, и доля ровняется до них.
    const coins = [
      { ...invoice({ status: 'paid', amount: Money.toAmount('4201'), payCode: 'USDT', payAmount: Money.toAmount('130') }), id: 'i' },
    ];
    // 1400 × 130 / 4201 = 43,3230183…
    expect(invoiceSummary(coins, back, 'USDT', 6).refunded).toBe('43.323018');
  });

  it('счёт, возвращённый частями целиком, не оставляет копейки в обороте', () => {
    // Три возврата по 300 THB из 900 THB за 2500 RUB: каждая треть —
    // 833,333… рубля, и округлённые порознь они давали 2499,99.
    const whole = [
      { ...invoice({ status: 'refunded', amount: Money.toAmount('900'), payAmount: Money.toAmount('2500') }), id: 'i' },
    ];
    const thirds = ['a', 'b', 'c'].map((id) => refund({ id, amount: Money.toAmount('300') }));
    const summary = invoiceSummary(whole, thirds, 'RUB', 0);
    expect(summary.refunded).toBe('2500');
    expect(Money.isZero(summary.net)).toBe(true);
  });

  it('без счетов конверсии нет, а не ноль процентов', () => {
    expect(invoiceSummary([], [], 'RUB', 0).conversion).toBeNull();
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

describe('отбор из адреса — один на страницу и выгрузку', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const read = (params: Record<string, string>) =>
    readInvoiceFilter((key) => params[key], now, 0);

  it('понимает таб, поиск, «только мои» и период', () => {
    const filter = read({ tab: 'refunded', q: ' 001 ', mine: '1', period: 'today' });
    expect(filter.status).toBe('refunded');
    expect(filter.query).toBe('001');
    expect(filter.mine).toBe(true);
    expect(filter.picked?.period.key).toBe('today');
    // Тот же отбор — теми же параметрами адреса: ссылка «Выгрузить» и
    // чипы собирают его отсюда, а не каждый своим способом.
    expect(invoiceFilterParams(filter)).toEqual({
      q: '001',
      tab: 'refunded',
      mine: '1',
      period: 'today',
    });
  });

  it('незнакомое — как отсутствующее, а не отказ', () => {
    const filter = read({ tab: 'выдумка', period: '999d', mine: 'да' });
    expect(filter.status).toBeUndefined();
    expect(filter.picked).toBeNull();
    expect(filter.mine).toBe(false);
    expect(invoiceFilterParams(filter)).toEqual({});
  });

  it('сужает список и строки одним правилом', () => {
    const rows = [
      invoice({ status: 'paid', createdAt: '2026-09-11T10:00:00.000Z' }),
      invoice({ status: 'issued', createdAt: '2026-09-11T10:00:00.000Z', authorId: 'u2' }),
      invoice({ status: 'paid', createdAt: '2026-09-01T10:00:00.000Z' }),
    ];
    const { found, rows: shown } = applyInvoiceFilter(
      rows,
      read({ tab: 'paid', period: 'today' }),
      'u1',
    );
    // Плитки считают найденное без таба, строки — с табом.
    expect(found).toHaveLength(2);
    expect(shown).toHaveLength(1);
    expect(applyInvoiceFilter(rows, read({ mine: '1' }), 'u1').found).toHaveLength(2);
  });
});

describe('действия с отмеченными счетами', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const rows = [
    { ...invoice({ status: 'issued', expiresAt: '2026-09-11T13:00:00.000Z' }), id: 'wait' },
    { ...invoice({ status: 'issued', expiresAt: '2026-09-11T11:00:00.000Z' }), id: 'late' },
    { ...invoice({ status: 'expired' }), id: 'gone' },
    { ...invoice({ status: 'cancelled' }), id: 'off' },
    { ...invoice({ status: 'paid' }), id: 'paid' },
    { ...invoice({ status: 'refunded' }), id: 'back' },
  ];
  const all = rows.map((one) => one.id);

  it('оплаченным отмечается только ждущий денег счёт', () => {
    // Истёкший по часам тоже не ждёт, даже если прочитан до истечения.
    expect(bulkTargets(rows, all, 'paid', now)).toEqual(['wait']);
  });

  it('удаляется только счёт, по которому денег не было', () => {
    // Оплаченный и возвращённый — история денег, и на них ссылаются
    // возвраты: удалённый такой счёт оставил бы возврат ни к чему.
    expect(bulkTargets(rows, all, 'delete', now)).toEqual(['wait', 'late', 'gone', 'off']);
  });

  it('чужие и незнакомые идентификаторы мимо', () => {
    expect(bulkTargets(rows, ['wait', 'нет-такого'], 'delete', now)).toEqual(['wait']);
  });

  it('удаление перепроверяет счёт в момент удаления: оплаченный за это время не удаляется', () => {
    // Между отбором и удалением идёт отмена у провайдера, и банк успевает
    // сообщить об оплате. Удалять такой счёт — стереть деньги из истории.
    forgetMock('race');
    const one = { ...invoice({ status: 'issued' }), id: 'raced' };
    addInvoice('race', one);
    replaceInvoiceForTest('race', paidByHand(one, now));
    expect(removeInvoices('race', ['raced'])).toEqual([]);
    expect(listInvoices('race')).toHaveLength(1);
    forgetMock('race');
  });

  it('удалённое пропадает из списка только у своего мерчанта', () => {
    forgetMock('bulk');
    forgetMock('other');
    const one = { ...invoice(), id: 'same' };
    addInvoice('bulk', one);
    addInvoice('other', one);
    removeInvoices('bulk', ['same']);
    expect(listInvoices('bulk')).toEqual([]);
    expect(listInvoices('other')).toHaveLength(1);
    forgetMock('bulk');
    forgetMock('other');
  });
});

describe('оплаченное по всем валютам — для списка у плитки', () => {
  it('называет каждую валюту сервиса, и пустую тоже', () => {
    const rows = [
      invoice({ status: 'paid' }),
      invoice({ status: 'paid', amount: Money.toAmount('500') }),
      invoice({ status: 'issued', code: 'CNY', amount: Money.toAmount('900') }),
    ];
    expect(currencyBreakdown(rows, ['RUB', 'THB', 'CNY'])).toEqual([
      // Рубль — валюта оплаты, а список про то, что получил покупатель.
      { code: 'RUB', amount: null, count: 0 },
      { code: 'THB', amount: '2500', count: 2 },
      // Ожидающий счёт — не деньги.
      { code: 'CNY', amount: null, count: 0 },
    ]);
  });
});

describe('слова на экране — владельца, а не образца', () => {
  it('плитки и кнопка строки названы так, как их просил владелец 8 сентября', () => {
    // CLAUDE.md: «всего счетов», «оплаченные счета», «оборот в USDT»,
    // «подробнее». Образец даёт устройство, но не слова: 11 сентября
    // «касса» вместо «посттерминала» стоила владельцу найденного раздела.
    expect(INVOICE_TILE_LABELS.total).toBe('Всего счетов');
    expect(INVOICE_TILE_LABELS.paid).toBe('Оплаченные счета');
    expect(INVOICE_TILE_LABELS.turnover('USDT')).toBe('Оборот в USDT');
    expect(INVOICE_OPEN_LABEL).toBe('Подробнее');
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
