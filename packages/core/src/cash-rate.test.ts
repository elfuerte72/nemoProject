import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  createCore,
  InvalidInputError,
  type Actor,
  type RatePair,
  type RateQuote,
  type RateSource,
} from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenFeeSchedule,
  givenNetwork,
  givenServiceSettings,
  givenStaff,
} from './test-support.js';

/**
 * Курс наличной сделки.
 *
 * Правило: **курс у наличной сделки есть везде, где есть котировка.**
 * Клиент видит цену до подачи, а не узнаёт её из разговора, — цена и
 * есть то, за чем открывают обменник.
 *
 * Считается она по наличной сетке ступеней, если администратор завёл её
 * в панели, и по наценке сервиса, если не завёл. Так же устроен и
 * перевод: сетка, а без неё наценка. Раньше пустая наличная сетка
 * означала отсутствие курса вовсе — правило отменено 14 августа 2026,
 * потому что заводить сетку на каждое наличное направление, чтобы
 * клиент просто увидел число, оказалось дорогой в никуда.
 *
 * Без курса наличная заявка остаётся только там, где котировки нет ни у
 * кого: тогда, как и прежде, цену называет менеджер.
 */

function givenRates(rates: Record<string, string>): RateSource {
  return {
    async quote(pair: RatePair): Promise<RateQuote | null> {
      const rate = rates[`${pair.fromCode}/${pair.toCode}`];
      return rate === undefined
        ? null
        : { rate: rate as RateQuote['rate'], asOf: new Date('2026-08-13T00:00:00Z') };
    },
  };
}

/** Доллар по сотне рублей — число круглое нарочно. */
const RATES = { 'USDT/RUB': '100', 'RUB/USDT': '0.01' };

/** Наличная ставка: три процента со всей суммы, без ступеней. */
const CASH_TIERS = [{ upToUsd: null, rateBps: 300 }];

/** Клиент, от лица которого подаются заявки в этих проверках. */
const CLIENT_ID = 100n;

const db = testDatabase();
const core = createCore({ db, rateSource: givenRates(RATES) });

let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  manager = await givenStaff({ role: 'manager' });
  await givenServiceSettings({ markupBps: 0, minExchangeAmount: '0' });
});

afterAll(() => closeTestDatabase());

describe('курс наличной сделки', () => {
  it('называется, когда у наличных заведена ставка', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    await givenFeeSchedule({ toCode: 'RUB', payoutMethod: 'cash', tiers: CASH_TIERS });

    const quote = await core.getQuote({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
      payoutMethod: 'cash',
    });

    // Тысяча USDT — тысяча долларов. Три процента, то есть 30 $, идут
    // сервису; остаётся 970 $, по сто рублей за доллар — 97 000 ₽.
    expect(quote?.toAmount).toBe('97000');
  });

  it('считается по наценке, пока своя ставка не заведена', async () => {
    await givenServiceSettings({ markupBps: 200, minExchangeAmount: '0' });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });

    // Курс у наличных есть всегда, когда есть котировка: клиент видит
    // цену до подачи, а не после разговора с менеджером. Пустая
    // наличная сетка означает наценку сервиса — ту же, по которой
    // считается перевод без своей сетки.
    const quote = await core.getQuote({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
      payoutMethod: 'cash',
    });

    // Сто рублей за доллар минус два процента наценки — 98.
    expect(quote?.rate).toBe('98');
    expect(quote?.toAmount).toBe('98000');
  });

  it('молчит, когда котировки нет вовсе', async () => {
    // Провайдер не знает пары — назвать нечего, и это рабочее
    // состояние: заявку клиент подаст, а цену назовёт менеджер.
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'THB', kind: 'cash' });

    const quote = await core.getQuote({
      fromCode: 'USDT',
      toCode: 'THB',
      fromAmount: '1000',
      payoutMethod: 'cash',
    });

    expect(quote).toBeNull();
  });

  it('не путает наличную ставку с безналичной', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB' });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    await givenFeeSchedule({ toCode: 'RUB', payoutMethod: 'cash', tiers: CASH_TIERS });

    // У перевода своя сетка не заведена, и он считается по наценке —
    // наличная ставка на него не распространяется.
    const electronic = await core.getQuote({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
      payoutMethod: 'bank',
    });
    expect(electronic?.toAmount).toBe('100000');

    const cash = await core.getQuote({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
      payoutMethod: 'cash',
    });
    expect(cash?.toAmount).toBe('97000');
  });

  it('не называется у направления, которого наличными нет', async () => {
    // Пара заведена только безналичной: наличных по ней сервис не
    // выдаёт, и курс наличных у неё взяться не может.
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB' });
    await givenFeeSchedule({ toCode: 'RUB', payoutMethod: 'cash', tiers: CASH_TIERS });

    const quote = await core.getQuote({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
      payoutMethod: 'cash',
    });

    expect(quote).toBeNull();
  });
});

describe('наличная заявка', () => {
  it('уходит с курсом и посчитанной суммой', async () => {
    await core.registerClient({ telegramUserId: CLIENT_ID });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    await givenFeeSchedule({ toCode: 'RUB', payoutMethod: 'cash', tiers: CASH_TIERS });

    const { request } = await core.submitExchangeRequest(asClient(CLIENT_ID), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
    });

    expect(request.requestRate).toBe('97');
    expect(request.toAmount).toBe('97000');
  });

  it('без своей ставки уходит с курсом по наценке', async () => {
    await core.registerClient({ telegramUserId: CLIENT_ID });
    await givenServiceSettings({ markupBps: 200, minExchangeAmount: '0' });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });

    const { request } = await core.submitExchangeRequest(asClient(CLIENT_ID), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
    });

    expect(request.requestRate).toBe('98');
    expect(request.toAmount).toBe('98000');
  });

  it('уходит без курса, когда котировки нет вовсе', async () => {
    await core.registerClient({ telegramUserId: CLIENT_ID });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'THB', kind: 'cash' });

    const { request } = await core.submitExchangeRequest(asClient(CLIENT_ID), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'THB',
      fromAmount: '1000',
    });

    expect(request.requestRate).toBeNull();
    expect(request.toAmount).toBeNull();
  });

  it('не даёт менеджеру назвать свой курс поверх названного при подаче', async () => {
    await core.registerClient({ telegramUserId: CLIENT_ID });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    await givenFeeSchedule({ toCode: 'RUB', payoutMethod: 'cash', tiers: CASH_TIERS });

    const { request } = await core.submitExchangeRequest(asClient(CLIENT_ID), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
    });
    await core.claimExchangeRequest(manager, request.id);

    // Курс, названный сервисом при подаче, — обязательство, и у
    // наличной сделки оно такое же, как у перевода (docs/adr/0006).
    await expect(
      core.confirmExchangeRate(manager, request.id, {
        finalRate: '90',
        paymentInstructions: 'Офис на Тверской, завтра с 12 до 18',
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});

describe('подсказка дохода', () => {
  /*
   * Подсказка вынимает наценку из курса. Там, где цену назначила сетка,
   * наценки в курсе нет вовсе, и посчитанное по ней число было бы
   * выдумкой, поданной как расчёт, — а доход по заявке это база
   * реферальных начислений (docs/adr/0003), и поправить его потом
   * нельзя.
   */
  it('молчит у заявки, посчитанной по сетке', async () => {
    await core.registerClient({ telegramUserId: CLIENT_ID });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    await givenFeeSchedule({ toCode: 'RUB', payoutMethod: 'cash', tiers: CASH_TIERS });

    const { request } = await core.submitExchangeRequest(asClient(CLIENT_ID), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
    });

    expect(await core.isRequestPricedBySchedule(manager, request.id)).toBe(true);
  });

  it('считает у заявки, посчитанной по наценке', async () => {
    await core.registerClient({ telegramUserId: CLIENT_ID });
    await givenServiceSettings({ markupBps: 200, minExchangeAmount: '0' });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB' });
    await givenNetwork('TRC20');
    const requisites = await core.saveRequisites(asClient(CLIENT_ID), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });

    const { request } = await core.submitExchangeRequest(asClient(CLIENT_ID), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
      requisitesId: requisites.id,
    });

    expect(await core.isRequestPricedBySchedule(manager, request.id)).toBe(false);
  });

  it('молчит у заявки без курса подачи: цену назвал менеджер', async () => {
    // Котировки на это направление нет ни у кого, поэтому заявка ушла
    // без курса, и вынимать наценку не из чего.
    await core.registerClient({ telegramUserId: CLIENT_ID });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'THB', kind: 'cash' });

    const { request } = await core.submitExchangeRequest(asClient(CLIENT_ID), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'THB',
      fromAmount: '1000',
    });

    expect(await core.isRequestPricedBySchedule(manager, request.id)).toBe(false);
  });
});
