import { describe, expect, it } from 'vitest';
import { isCoreError } from '@nemo/http';
import { Money, type Quote } from '@nemo/types';
import { examplePay, makeInvoice, markupRate, payRounding, posRateLine, posSides } from '../pos';
import { addInvoice, findInvoice, forgetMock, getPosSettings, listInvoices, savePosSettings } from '../mock/store';
import { acquirer, IMITATION, QR_TTL_MS } from './acquirer';
import { listenersOf, publishPos, subscribePos, type PosEvent } from './bus';
import { demoAsked, demoPay, demoSet, DEMO_AUTHOR } from './demo';
import { imitationQr, qrWindow } from './imitation';
import { cancelledByHand, expireDue, isPayable, paidByProvider } from './lifecycle';
import { acceptPayment } from './payments';
import { markupPercent, parseMarkupPercent, POS_SETTINGS_COMPLAINTS } from './settings';

/**
 * Имитация приёма платежа: всё, чего глазом не проверить, — переходы
 * счёта по часам, окно QR, наценка в обе стороны счёта, примеры и
 * одна точка приёма оплаты на всех провайдеров.
 */

const at = new Date('2026-09-22T10:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);

const quote: Quote = { rate: Money.toAmount('0.4'), payoutDecimals: 2 };

function invoice(over: Partial<Parameters<typeof makeInvoice>[0]> = {}) {
  return makeInvoice({
    number: '2026-09-22-001',
    author: 'Оплатишка',
    code: 'THB',
    amount: Money.toAmount('2000'),
    payCode: 'RUB',
    payAmount: Money.toAmount('5000'),
    rate: Money.toAmount('0.4'),
    markupBps: 0,
    kycRequired: false,
    at,
    expiresAt: later(60),
    ...over,
  });
}

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return isCoreError(error) ? error.code : 'не ошибка ядра';
  }
}

describe('наценка мерчанта', () => {
  it('без наценки счёт тот же, что был', () => {
    expect(posSides(Money.toAmount('5000'), 'pay', quote)).toEqual(
      posSides(Money.toAmount('5000'), 'pay', quote, 0),
    );
    expect(markupRate(Money.toAmount('0.4'), 0)).toBe('0.4');
  });

  it('пять процентов — покупатель платит на пять процентов больше за то же', () => {
    // Назвали баты: рублей нужно на 5 % больше, вверх до рубля.
    const buy = posSides(Money.toAmount('2000'), 'buy', quote, 500);
    expect(buy.pay).toBe('5250');
    // Назвали рубли: батов на те же деньги выходит меньше.
    const pay = posSides(Money.toAmount('5250'), 'pay', quote, 500);
    expect(pay.buy).toBe('2000');
    // Курс на плитке — тот, по которому сходится счёт: до знаков валюты,
    // потому что 0,4 / 1,05 — периодическая дробь.
    expect(
      Money.roundTo(Money.multiply(markupRate(Money.toAmount('0.4'), 500), Money.toAmount('5250')), 2),
    ).toBe('2000');
  });

  it('черта курса называет курс с наценкой, а порог — в рублях покупателя', () => {
    const line = posRateLine(quote, null, Money.toAmount('10'), 500);
    expect(line.kind).toBe('rate');
    if (line.kind === 'rate') expect(Money.roundTo(line.rate, 6)).toBe('0.380952');
  });

  it('проценты из поля — в базисные пункты и обратно', () => {
    expect(parseMarkupPercent('2,5')).toEqual({ ok: true, bps: 250 });
    expect(parseMarkupPercent('0')).toEqual({ ok: true, bps: 0 });
    expect(parseMarkupPercent('100')).toEqual({ ok: true, bps: 10_000 });
    expect(parseMarkupPercent('100,01')).toEqual({ ok: false, complaint: POS_SETTINGS_COMPLAINTS.markupRange });
    expect(parseMarkupPercent('1,234')).toEqual({ ok: false, complaint: POS_SETTINGS_COMPLAINTS.markupStep });
    expect(parseMarkupPercent('два')).toEqual({ ok: false, complaint: POS_SETTINGS_COMPLAINTS.markupNumber });
    expect(markupPercent(250)).toBe('2,5');
    expect(markupPercent(205)).toBe('2,05');
    expect(markupPercent(0)).toBe('0');
  });

  it('наценка записывается в счёт вместе с курсом', () => {
    expect(invoice({ markupBps: 250 }).markupBps).toBe(250);
  });
});

describe('настройки терминала', () => {
  it('хранятся по мерчанту и без записи равны умолчаниям', () => {
    forgetMock('shop');
    expect(getPosSettings('shop')).toEqual({ markupBps: 0 });
    savePosSettings('shop', { markupBps: 300 });
    expect(getPosSettings('shop').markupBps).toBe(300);
    expect(getPosSettings('other').markupBps).toBe(0);
  });

  it('объяснение без своей суммы считает на пяти тысячах рублей', () => {
    // Пример должен узнаваться как обычная продажа у стойки.
    expect(examplePay()).toBe('5000');
    expect(posSides(examplePay(), 'pay', quote, 0).buy).toBe('2000');
  });
});

/*
 * Чем платит покупатель: рублями или монетой. Сервис принимает обе, и
 * ровняются они по-разному — у рубля до целой единицы, у монеты до её
 * знака: целая монета стоит под сотню рублей, и ровнять до неё значит
 * просить с покупателя лишнюю сотню.
 */
describe('валюта оплаты', () => {
  it('фиат ровняется до целой единицы, монета — до своего знака', () => {
    expect(payRounding({ kind: 'fiat', decimals: 2 })).toBe(0);
    expect(payRounding({ kind: 'crypto', decimals: 6 })).toBe(6);
  });

  it('счёт в рублях остаётся ровным', () => {
    // Полтиража копейки у стойки не отдают: вверх до рубля.
    expect(posSides(Money.toAmount('4999.01'), 'pay', quote, 0, 0).pay).toBe('5000');
  });

  it('счёт в монете не поднимается до целой монеты', () => {
    // Вверх на шестом знаке — а не «55,648303 → 56», то есть плюс
    // тридцать тысяч рублей на ровном месте.
    const pay = posSides(Money.toAmount('55.6483031'), 'pay', quote, 0, 6).pay;
    expect(pay).toBe('55.648304');
  });

  it('обратный счёт в монете ровняется тем же знаком', () => {
    // «Нужно ровно 2 000 бат» при курсе 0,4: 5 000 монет ровно, и
    // хвоста, который пришлось бы поднимать, тут нет.
    expect(posSides(Money.toAmount('2000'), 'buy', quote, 0, 6).pay).toBe('5000');
  });
});

describe('жизнь счёта', () => {
  it('ждёт денег до срока, а по сроку истекает с записью в ленте', () => {
    const one = invoice();
    expect(isPayable(one, later(59))).toBe(true);
    expect(expireDue(one, later(59))).toBe(one);

    const due = expireDue(one, later(60));
    expect(due.status).toBe('expired');
    expect(isPayable(due, later(60))).toBe(false);
    expect(due.events.at(-1)?.what).toBe('Срок оплаты вышел');
    // Истёк ровно в срок, а не когда прочитали.
    expect(due.events.at(-1)?.at).toBe(later(60).toISOString());
  });

  it('оплаченный и отменённый не истекают', () => {
    const paid = paidByProvider(invoice(), { at: later(5), providerTitle: 'Имитация' });
    expect(expireDue(paid, later(120)).status).toBe('paid');
    expect(expireDue(cancelledByHand(invoice(), later(5)), later(120)).status).toBe('cancelled');
  });

  it('без срока счёт живёт, пока его не закроют', () => {
    expect(expireDue(invoice({ expiresAt: null }), later(10_000)).status).toBe('issued');
  });

  it('оплата с верификацией пишет в ленту две строки', () => {
    const paid = paidByProvider(invoice({ kycRequired: true }), {
      at: later(3),
      providerTitle: 'Имитация',
    });
    expect(paid.kycPassedAt).toBe(later(3).toISOString());
    expect(paid.events.map((event) => event.what)).toEqual([
      'Счёт создан: Оплатишка',
      'Личность покупателя подтверждена: Имитация',
      'Оплачен: платёж принял провайдер «Имитация»',
    ]);
  });

  it('список отдаётся с уже истёкшими счетами', () => {
    forgetMock('shop');
    addInvoice('shop', invoice());
    expect(listInvoices('shop', later(30))[0]?.status).toBe('issued');
    expect(listInvoices('shop', later(61))[0]?.status).toBe('expired');
    // И запоминает это: следующее чтение не переигрывает переход.
    expect(findInvoice('shop', listInvoices('shop')[0]!.id, later(61))?.events).toHaveLength(2);
  });
});

describe('имитация провайдера', () => {
  it('стоит по умолчанию, а незнакомое имя — отказ, а не молчаливая имитация', () => {
    expect(acquirer({}).name).toBe(IMITATION);
    expect(acquirer({ POS_ACQUIRER: 'imitation' }).title).toBe('Имитация');
    expect(() => acquirer({ POS_ACQUIRER: 'sbp-bank' })).toThrow(/не подключён/u);
  });

  it('QR живёт пять минут и меняется на границе окна', () => {
    const first = imitationQr('imit_1', at);
    expect(qrWindow(at)).toBe(Math.floor(at.getTime() / QR_TTL_MS));
    expect(new Date(first.expiresAt).getTime() - new Date(first.issuedAt).getTime()).toBe(QR_TTL_MS);
    expect(imitationQr('imit_1', new Date(new Date(first.expiresAt).getTime() - 1)).payload).toBe(
      first.payload,
    );
    expect(imitationQr('imit_1', new Date(first.expiresAt)).payload).not.toBe(first.payload);
  });

  it('ссылка на оплату — то же, что в QR, текстом', () => {
    // У СБП в QR зашита ссылка на оплату, и отправить её покупателю,
    // который не у стойки, — то же, что показать ему код. У имитации
    // ссылка такая же ненастоящая, как QR, и ничего не откроет.
    const qr = imitationQr('imit_1', at);
    expect(qr.link).toBe(qr.payload);
  });

  it('содержимое QR не похоже на ссылку банка', () => {
    const { payload } = imitationQr('imit_1', at);
    expect(payload).toMatch(/IMITATION/u);
    expect(payload).not.toMatch(/https?:|nspk|qr\.ru/iu);
  });

  it('возврат у имитации исполняется сразу', async () => {
    const outcome = await acquirer({}).refund('imit_1', Money.toAmount('100'), 'THB', at);
    expect(outcome.state).toBe('done');
  });
});

describe('приём оплаты — одна точка', () => {
  it('переводит счёт, пишет ленту и толкает вкладки мерчанта', () => {
    forgetMock('shop');
    const one = { ...invoice(), payment: { provider: IMITATION, ref: 'imit_x' } };
    addInvoice('shop', one);
    const heard: PosEvent[] = [];
    const stop = subscribePos('shop', (event) => heard.push(event));

    const paid = acceptPayment('shop', one.id, { provider: IMITATION, providerTitle: 'Имитация', at: later(2) });
    expect(paid.status).toBe('paid');
    expect(findInvoice('shop', one.id)?.status).toBe('paid');
    expect(heard).toEqual([{ kind: 'invoice', id: one.id }]);

    // Второе сообщение о том же — отказ, а не «принято»: провайдер
    // решил бы, что деньги учтены дважды.
    expect(codeOf(() => acceptPayment('shop', one.id, { provider: IMITATION, providerTitle: 'Имитация', at: later(3) }))).toBe(
      'invalid-input',
    );
    stop();
    expect(listenersOf('shop')).toBe(0);
  });

  it('истёкший и чужой провайдер — отказ', () => {
    forgetMock('shop');
    const one = { ...invoice(), payment: { provider: IMITATION, ref: 'imit_y' } };
    addInvoice('shop', one);
    expect(codeOf(() => acceptPayment('shop', one.id, { provider: 'bank', providerTitle: 'Банк', at: later(1) }))).toBe(
      'invalid-input',
    );
    expect(codeOf(() => acceptPayment('shop', one.id, { provider: IMITATION, providerTitle: 'Имитация', at: later(61) }))).toBe(
      'invalid-input',
    );
    expect(codeOf(() => acceptPayment('shop', 'нет такого', { provider: IMITATION, providerTitle: 'Имитация', at }))).toBe(
      'not-found',
    );
  });

  it('упавший слушатель не мешает соседям', () => {
    const heard: string[] = [];
    const stopBad = subscribePos('room', () => {
      throw new Error('упал');
    });
    const stopGood = subscribePos('room', (event) => heard.push(event.id));
    publishPos('room', { kind: 'refund', id: 'r1' });
    publishPos('elsewhere', { kind: 'refund', id: 'r2' });
    expect(heard).toEqual(['r1']);
    stopBad();
    stopGood();
  });
});

describe('примеры', () => {
  it('заводятся только по просьбе', () => {
    expect(demoAsked({})).toBe(false);
    expect(demoAsked({ POS_DEMO_SEED: '0' })).toBe(false);
    expect(demoAsked({ POS_DEMO_SEED: '1' })).toBe(true);
    expect(demoAsked({ POS_DEMO_SEED: 'да' })).toBe(true);
  });

  it('набор один и тот же, подписан и содержит каждое состояние', () => {
    const first = demoSet(at);
    const second = demoSet(at);
    expect(first.invoices.map((one) => one.number)).toEqual(second.invoices.map((one) => one.number));
    expect(first.invoices.every((one) => one.demo && one.author === DEMO_AUTHOR)).toBe(true);
    expect(first.refunds.every((one) => one.demo && one.status === 'done')).toBe(true);

    const statuses = new Set(first.invoices.map((one) => one.status));
    expect([...statuses].sort()).toEqual(['cancelled', 'expired', 'issued', 'paid', 'refunded']);
    expect(first.refunds.length).toBeGreaterThanOrEqual(2);
    // Возврат — только по оплаченному и не больше его суммы; возвращённый
    // целиком счёт был оплачен и стал возвращённым.
    for (const refund of first.refunds) {
      const owner = first.invoices.find((one) => one.id === refund.invoiceId)!;
      expect(['paid', 'refunded']).toContain(owner.status);
      expect(Money.compare(refund.amount, owner.amount)).toBeLessThanOrEqual(0);
    }
  });

  it('ничего не лежит в будущем, а ожидающий счёт ещё можно оплатить', () => {
    const { invoices } = demoSet(at);
    expect(invoices.every((one) => new Date(one.createdAt).getTime() <= at.getTime())).toBe(true);
    const open = invoices.find((one) => one.status === 'issued')!;
    expect(isPayable(open, at)).toBe(true);
    expect(isPayable(open, later(41))).toBe(false);
  });

  it('счёт в примерах посчитан той же арифметикой: рубли вверх до целого', () => {
    const { invoices } = demoSet(at);
    for (const one of invoices) {
      expect(one.payAmount).toBe(demoPay(one.code, one.amount));
      expect(one.payAmount).toMatch(/^\d+$/u);
    }
  });

  it('номера идут по дню и не повторяются', () => {
    const numbers = demoSet(at).invoices.map((one) => one.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
