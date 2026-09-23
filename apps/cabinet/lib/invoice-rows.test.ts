import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { Money, type Quote } from '@nemo/types';
import {
  INVOICE_COLUMN_LABELS,
  invoiceCell,
  invoiceColumns,
  invoiceCurrencies,
  invoiceMoneyLines,
  invoiceSummary,
  owedRefunds,
  REFUND_COLUMN_LABELS,
  refundBreakdown,
  refundCell,
  refundColumns,
  refundLeft,
  refundSummary,
  searchInvoices,
  type MockInvoice,
  type MockRefund,
} from './invoice-rows';
import { buyerPays, makeInvoice, nextNumber, posSides } from './pos';
import { addInvoice, forgetMock, listInvoices } from './mock/store';
import {
  INVOICE_OPEN_LABEL,
  INVOICES_HOW_TO,
  INVOICES_NOTE,
  POS_HOW_TO,
  PREVIEW_NOTE,
  REFUNDS_HOW_TO,
  REFUNDS_NOTE,
} from './pos-texts';

/**
 * Счета и возвраты — макет, но правила у него те же: колонки в одном
 * месте, валюты не складываются, сумма к оплате округляется вверх, а
 * выборка мерчанта не видит чужого.
 */

const at = new Date('2026-09-11T10:00:00Z');

const invoice = (over: Partial<MockInvoice> = {}): MockInvoice => ({
  ...makeInvoice({
    number: '2026-09-11-001',
    author: 'Оплатишка',
    code: 'THB',
    amount: Money.toAmount('2000'),
    payCode: 'RUB',
    payAmount: Money.toAmount('5600'),
    rate: Money.toAmount('2.8'),
    markupBps: 0,
    kycRequired: false,
    at,
    expiresAt: null,
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

  it('выдача, съеденная комиссией, — не счёт, а отказ', () => {
    // Арифметика клампит съеденную комиссией выдачу в ноль. Счёт на
    // «0 THB по курсу 0» — не сделка: теми же словами это отвергает
    // подача заявки в ядре.
    const eaten: Quote = {
      rate: Money.toAmount('0.4'),
      payoutDecimals: 2,
      fee: {
        toBaseRate: Money.toAmount('0.01'),
        fromBaseRate: Money.toAmount('35'),
        tiers: [{ upToUsd: null, rateBps: 0, fixedPayout: Money.toAmount('1000') }],
        minUsd: null,
        thresholdInclusive: true,
      },
    };
    expect(posSides(Money.toAmount('100'), 'pay', eaten).buy).toBeNull();
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

  it('сделка — двумя колонками: сколько покупатель платит и сколько получает', () => {
    const pays = invoiceCell(invoice(), 'pays');
    const cell = invoiceCell(invoice(), 'gets');
    // Литералом, а не через `formatMoney`: утверждение, повторяющее
    // вычисление из кода, не заметит, если разряды начнут разделять
    // иначе. Пробел здесь узкий неразрывный — тот самый, что ставит
    // `formatAmount` (U+202F), и написан он последовательностью: в
    // исходнике его не отличить от обычного.
    expect(cell.text).toBe('2\u202f000 THB');
    expect(cell.flag).toBe('THB');
    expect(pays.text).toBe('5\u202f600 RUB');
    expect(pays.flag).toBe('RUB');
    // \u041a\u0443\u0440\u0441 \u2014 \u043f\u043e \u0437\u0430\u043f\u0438\u0441\u0430\u043d\u043d\u043e\u043c\u0443 \u0432 \u0441\u0447\u0451\u0442, \u043c\u0435\u043b\u043a\u043e \u043f\u043e\u0434 \u043f\u043e\u043b\u0443\u0447\u0430\u0435\u043c\u044b\u043c: \u043e\u043d \u043e\u0431\u044a\u044f\u0441\u043d\u044f\u0435\u0442
    // \u0432\u0442\u043e\u0440\u0443\u044e \u0441\u0443\u043c\u043c\u0443 \u0447\u0435\u0440\u0435\u0437 \u043f\u0435\u0440\u0432\u0443\u044e.
    expect(cell.meta).toContain('2,8');
    expect(INVOICE_COLUMN_LABELS.pays).toBe('\u041f\u043e\u043a\u0443\u043f\u0430\u0442\u0435\u043b\u044c \u043f\u043b\u0430\u0442\u0438\u0442');
    expect(INVOICE_COLUMN_LABELS.gets).toBe('\u041f\u043e\u043a\u0443\u043f\u0430\u0442\u0435\u043b\u044c \u043f\u043e\u043b\u0443\u0447\u0430\u0435\u0442');
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
        doneAt: null,
        provider: null,
        demo: false,
      },
      'retained',
    );
    expect(cell.text).toBe('—');
    expect(cell.meta).toBe('возврат целиком');
    expect(refundColumns).toContain('retained');
  });

  it('строка возврата: значок валюты у суммы, почему ждёт и когда исполнен', () => {
    const base: MockRefund = {
      id: 'r1',
      invoiceId: 'i1',
      invoiceNumber: '2026-09-11-001',
      code: 'THB',
      amount: Money.toAmount('700'),
      retained: null,
      reason: 'Передумал',
      status: 'pending',
      createdAt: at.toISOString(),
      doneAt: null,
      provider: null,
      demo: false,
    };
    // Сумма — тем же приёмом, что сделка в списке счетов.
    const amount = refundCell(base, 'amount');
    expect(amount.text).toBe('700 THB');
    expect(amount.flag).toBe('THB');
    // Ждёт без провайдера — счёт оплачен мимо сервиса, и строка говорит,
    // почему заявка стоит, а не оставляет гадать.
    expect(refundCell(base, 'status').meta).toBe('возвращать некому');
    // Ждёт у провайдера — ничего не объясняет: банк просто ещё не ответил.
    expect(refundCell({ ...base, provider: 'imitation' }, 'status').meta).toBeUndefined();
    expect(refundCell({ ...base, demo: true }, 'status').meta).toBe('пример · возвращать некому');

    const done = { ...base, status: 'done' as const, provider: 'imitation', doneAt: '2026-09-12T10:00:00Z' };
    expect(refundCell(done, 'created')).toMatchObject({ text: '2026-09-11', meta: 'исполнен 2026-09-12' });
    expect(refundCell(base, 'created').meta).toBeUndefined();

    // Колонки и подписи — одним набором, кнопка строки — «Подробнее».
    const header = refundColumns.map((column) => REFUND_COLUMN_LABELS[column]);
    expect(header.every((label) => label.length > 0)).toBe(true);
    expect(refundCell(base, 'open').text).toBe(INVOICE_OPEN_LABEL);
  });
});

describe('числа над списком', () => {
  it('в обороте только оплаченные счета, а валюты не складываются', () => {
    const rows = [
      invoice({ status: 'paid' }),
      invoice({
        status: 'paid',
        code: 'CNY',
        amount: Money.toAmount('500'),
        payAmount: Money.toAmount('6600'),
        rate: Money.toAmount('13.2'),
      }),
      // Ожидающий и отменённый — бумага, а не деньги: «оборот 50 000»
      // рядом с «оплачено 0» читался бы как ошибка в счётчике.
      invoice({ status: 'issued', payAmount: Money.toAmount('9999') }),
      invoice({ status: 'cancelled', payAmount: Money.toAmount('8888') }),
    ];

    // Рубли — точная сумма: у каждого счёта записан свой курс.
    expect(invoiceSummary(rows, [], 'RUB', 0).paidSum).toBe('12200');
    // Баты — только по батовым счетам: свести их с юанями нечем.
    expect(invoiceSummary(rows, [], 'THB', 2).paidSum).toBe('2000');
    // Валюты для выбора берутся из всех счетов: ожидающий тоже в
    // какой-то валюте, и пропавший из списка выбор сбивал бы с толку.
    expect(invoiceCurrencies(rows)).toEqual(['CNY', 'RUB', 'THB']);
    expect(invoiceMoneyLines(rows)).toEqual([
      { code: 'CNY', amount: '500', count: 1 },
      { code: 'THB', amount: '2000', count: 1 },
    ]);
  });

  it('без оплаченных оборота нет', () => {
    const rows = [invoice({ status: 'issued' }), invoice({ status: 'cancelled' })];
    expect(invoiceSummary(rows, [], 'RUB', 0)).toMatchObject({ paidSum: '0', paid: 0 });
    expect(invoiceMoneyLines(rows)).toEqual([]);
  });

  it('поиск по номеру сужает список, а не прячет строки', () => {
    const rows = [invoice(), invoice({ number: '2026-09-11-002' })];
    expect(searchInvoices(rows, '002')).toHaveLength(1);
    expect(searchInvoices(rows, '2026-09-11')).toHaveLength(2);
    expect(searchInvoices(rows, '  ')).toHaveLength(2);
    expect(searchInvoices(rows, 'ничего')).toHaveLength(0);
  });

  it('день счёта — местный и в номере, и в ячейке даты', () => {
    // Три часа ночи 12 сентября в Бангкоке — это ещё 11-е по UTC.
    const night = new Date('2026-09-11T20:00:00Z');
    const bangkok = 7 * 60;
    expect(nextNumber([], night, bangkok)).toBe('2026-09-12-001');
    expect(nextNumber([], night)).toBe('2026-09-11-001');

    const one = invoice({ createdAt: night.toISOString() });
    expect(invoiceCell(one, 'created', bangkok).text).toBe('2026-09-12');
    expect(invoiceCell(one, 'created').text).toBe('2026-09-11');
  });

  it('номер счёта продолжает день, а не начинается заново', () => {
    const first = invoice({ number: nextNumber([], at) });
    expect(first.number).toBe('2026-09-11-001');
    expect(nextNumber([first], at)).toBe('2026-09-11-002');
    // Другой день начинается с первого.
    expect(nextNumber([first], new Date('2026-09-12T09:00:00Z'))).toBe('2026-09-12-001');
  });
});

describe('остаток по счёту', () => {
  const refund = (over: Partial<MockRefund>): MockRefund => ({
    id: 'r',
    invoiceId: 'i',
    invoiceNumber: '2026-09-11-001',
    code: 'THB',
    amount: Money.toAmount('500'),
    retained: null,
    reason: 'причина',
    status: 'pending',
    createdAt: at.toISOString(),
    doneAt: null,
    provider: null,
    demo: false,
    ...over,
  });

  it('считается по обещанным заявкам, отклонённые не в счёт', () => {
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    expect(refundLeft(one, [])).toBe('2000');
    expect(refundLeft(one, [refund({})])).toBe('1500');
    // Отклонённая ничего не обещает — остаток от неё не уменьшается.
    expect(refundLeft(one, [refund({ status: 'rejected' })])).toBe('2000');
    // Чужие заявки по другому счёту тоже мимо.
    expect(refundLeft(one, [refund({ invoiceId: 'другой' })])).toBe('2000');
    expect(owedRefunds([refund({}), refund({ status: 'rejected' })])).toHaveLength(1);
  });

  it('остаток не уходит в минус', () => {
    const one = { ...invoice({ status: 'paid' }), id: 'i' };
    expect(refundLeft(one, [refund({ amount: Money.toAmount('5000') })])).toBe('0');
  });
});

describe('числа над списком возвратов', () => {
  const refund = (over: Partial<MockRefund>): MockRefund => ({
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

  it('«в работе» — всё, по чему деньги ещё не ушли: и ждущие, и одобренные', () => {
    const rows = [
      refund({ status: 'pending', provider: null, doneAt: null }),
      refund({ status: 'approved', doneAt: null }),
      refund({}),
      refund({}),
      refund({ status: 'rejected', doneAt: null }),
    ];
    expect(refundSummary(rows)).toEqual({
      total: 5,
      pending: 1,
      approved: 1,
      inWork: 2,
      done: 2,
      rejected: 1,
    });
    expect(refundSummary([])).toMatchObject({ total: 0, inWork: 0, done: 0, rejected: 0 });
  });

  it('к возврату — по каждой валюте списка, без отклонённых и без сложения валют', () => {
    const rows = [
      refund({ amount: Money.toAmount('700') }),
      refund({ amount: Money.toAmount('1200.5'), status: 'pending', doneAt: null }),
      // Отклонённая ничего не обещает — ни в сумму, ни в счётчик.
      refund({ amount: Money.toAmount('9999'), status: 'rejected', doneAt: null }),
      refund({ code: 'CNY', amount: Money.toAmount('85') }),
    ];
    expect(refundBreakdown(rows, ['RUB', 'USDT', 'THB', 'CNY'])).toEqual([
      // Пустая валюта названа тоже: «рублями не возвращали» — такой же
      // ответ, как «вернули 1 900 батов».
      { code: 'RUB', amount: null, count: 0 },
      { code: 'USDT', amount: null, count: 0 },
      { code: 'THB', amount: '1900.5', count: 2 },
      { code: 'CNY', amount: '85', count: 1 },
    ]);
  });

  it('валюта, по которой всё отклонено, пуста, а не ноль', () => {
    const rows = [refund({ status: 'rejected', doneAt: null })];
    expect(refundBreakdown(rows, ['THB'])).toEqual([{ code: 'THB', amount: null, count: 0 }]);
  });
});

describe('тексты терминала, счетов и возвратов набраны человеком', () => {
  it.each([
    ['POS-терминал', POS_HOW_TO],
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

  it('список возвратов называет, в какую сторону идут деньги', () => {
    expect(slopComplaints(REFUNDS_NOTE)).toEqual([]);
    expect(REFUNDS_NOTE).toMatch(/покупател/u);
  });

  it('список счетов называет, кто кому платит', () => {
    expect(slopComplaints(INVOICES_NOTE)).toEqual([]);
    expect(INVOICES_NOTE).toMatch(/покупател/u);
    expect(INVOICES_NOTE).toMatch(/платят вам/u);
  });
});

describe('память макета', () => {
  it('чужих счетов мерчант не видит', () => {
    forgetMock('shop');
    forgetMock('other');
    addInvoice('shop', invoice());
    addInvoice('other', invoice({ author: 'Чужой' }));

    expect(listInvoices('shop')).toHaveLength(1);
    expect(listInvoices('shop')[0]?.author).toBe('Оплатишка');
    expect(listInvoices('nobody')).toEqual([]);
  });
});
