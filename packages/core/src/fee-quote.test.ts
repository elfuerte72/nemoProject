import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type RatePair, type RateQuote, type RateSource } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenFeeSchedule,
  givenServiceSettings,
  testRequisiteKeys,
} from './test-support.js';

/**
 * Комиссия по ступеням вместо наценки — там, где владелец прислал сетку.
 *
 * Считается по ТЗ: сумма переводится в доллары, по долларовому
 * эквиваленту выбирается ступень, ставка вычитается в долларах, остаток
 * умножается на курс валюты выдачи. Клиент долларов не видит.
 *
 * Числа во всех проверках посчитаны от правила вручную, а не тем же
 * выражением, что в коде.
 */

/** Источник, который котирует ровно перечисленные пары. */
function givenRates(rates: Record<string, string>): RateSource {
  return {
    async quote(pair: RatePair): Promise<RateQuote | null> {
      const rate = rates[`${pair.fromCode}/${pair.toCode}`];
      return rate === undefined
        ? null
        : { rate: rate as RateQuote['rate'], asOf: new Date('2026-08-12T00:00:00Z') };
    },
  };
}

/** Сетка бата на банк из ТЗ владельца. */
const BANK_TIERS = [
  { upToUsd: '500', fixedUsd: '5' },
  { upToUsd: '2000', rateBps: 450 },
  { upToUsd: '5000', rateBps: 350 },
  { upToUsd: null, rateBps: 250 },
];

/** Она же на кошелёк — дороже банка на процентный пункт. */
const WALLET_TIERS = [
  { upToUsd: '500', fixedUsd: '10' },
  { upToUsd: '2000', rateBps: 550 },
  { upToUsd: '5000', rateBps: 450 },
  { upToUsd: null, rateBps: 350 },
];

/** Рубль по сотой доллара, бат по тридцать за доллар — числа круглые нарочно. */
const RATES = { 'RUB/USDT': '0.01', 'USDT/THB': '30', 'USDT/RUB': '100' };

const db = testDatabase();

beforeEach(async () => {
  await resetDatabase();
  await db.execute('select 1');
});

afterAll(() => closeTestDatabase());

describe('котировка по сетке комиссии', () => {
  it('считает выдачу через долларовый эквивалент', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    const core = createCore({ db, rateSource: givenRates(RATES) });

    const quote = await core.getQuote({
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '100000',
      payoutMethod: 'bank',
    });

    // 100 000 ₽ — это 1 000 $. Ступень до двух тысяч: 4,5% — 45 $.
    // Остаётся 955 $, по тридцать бат за доллар — 28 650 ฿.
    expect(quote?.toAmount).toBe('28650');
  });

  it('на нижней ступени берёт фиксированную сумму', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    const core = createCore({ db, rateSource: givenRates(RATES) });

    const quote = await core.getQuote({
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '50000',
      payoutMethod: 'bank',
    });

    // 50 000 ₽ — 500 $, фикс 5 $, остаётся 495 $ — 14 850 ฿.
    expect(quote?.toAmount).toBe('14850');
  });

  it('берёт сетку того способа, которым уйдут деньги', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'wallet', tiers: WALLET_TIERS });
    const core = createCore({ db, rateSource: givenRates(RATES) });

    const wallet = await core.getQuote({
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '100000',
      payoutMethod: 'wallet',
    });

    // Тысяча долларов в кошелёк — 5,5%, то есть 55 $. Остаётся 945 $ —
    // 28 350 ฿ против 28 650 ฿ банковских.
    expect(wallet?.toAmount).toBe('28350');
  });

  it('не применяет наценку сверх комиссии', async () => {
    // Иначе клиент платит дважды: процент в курсе и комиссию поверх.
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    await givenServiceSettings({ markupBps: 1000 });
    const core = createCore({ db, rateSource: givenRates(RATES) });

    const quote = await core.getQuote({
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '100000',
      payoutMethod: 'bank',
    });

    // Наценка в 10% не тронула ни курс, ни выдачу.
    expect(quote?.toAmount).toBe('28650');
    expect(quote?.markupBps).toBe(0);
  });

  it('молчит о курсе, пока не названа сумма', async () => {
    // Со ступенями курс зависит от суммы: на ста долларах фикс — это
    // десятая часть, на пяти тысячах — две тысячных. Один курс на
    // направление назвать нельзя, а назвать его без комиссии значило бы
    // пообещать больше, чем сервис отдаст.
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    const core = createCore({ db, rateSource: givenRates(RATES) });

    expect(
      await core.getQuote({ fromCode: 'RUB', toCode: 'THB', payoutMethod: 'bank' }),
    ).toBeNull();
  });

  it('оставляет наценку там, где сетки нет', async () => {
    // Обмен USDT на рубли живёт по прежнему правилу: ступени бата туда
    // не переносятся.
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB' });
    await givenServiceSettings({ markupBps: 200 });
    const core = createCore({ db, rateSource: givenRates(RATES) });

    const quote = await core.getQuote({ fromCode: 'USDT', toCode: 'RUB', fromAmount: '10' });

    // Наценка 2% от сотни — курс 98, за десять монет 980 ₽.
    expect(quote).toMatchObject({ rate: '98', toAmount: '980', markupBps: 200 });
  });

  it('не применяет погашенную сетку', async () => {
    // Погашенная сетка возвращает направление к наценке, а не отменяет
    // цену вовсе.
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({
      toCode: 'THB',
      payoutMethod: 'bank',
      tiers: BANK_TIERS,
      isActive: false,
    });
    await givenServiceSettings({ markupBps: 0 });
    // Пару целиком здесь отдаёт сам источник: в рабочей сборке её
    // собирает составной провайдер (`cross.ts` в `@nemo/rates`), а
    // ветка без сетки спрашивает именно её, а не два звена.
    const core = createCore({ db, rateSource: givenRates({ ...RATES, 'RUB/THB': '0.3' }) });

    const quote = await core.getQuote({
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '100000',
      payoutMethod: 'bank',
    });

    // Без комиссии и без наценки: сотая доллара на тридцать бат — 0,3.
    expect(quote?.toAmount).toBe('30000');
  });

  it('молчит, когда молчит хотя бы одно звено пути', async () => {
    // Половина пути — не цена: без курса бата выдачу не посчитать, а
    // отдавать её по одному звену значит выдумывать.
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    const core = createCore({ db, rateSource: givenRates({ 'RUB/USDT': '0.01' }) });

    expect(
      await core.getQuote({
        fromCode: 'RUB',
        toCode: 'THB',
        fromAmount: '100000',
        payoutMethod: 'bank',
      }),
    ).toBeNull();
  });

  it('считает USDT долларом, а не гоняет его через себя', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    const core = createCore({ db, rateSource: givenRates(RATES) });

    const quote = await core.getQuote({
      fromCode: 'USDT',
      toCode: 'THB',
      fromAmount: '1000',
      payoutMethod: 'bank',
    });

    // Тысяча монет — тысяча долларов, комиссия 45, остаётся 955.
    expect(quote?.toAmount).toBe('28650');
  });
});

describe('заявка по сетке комиссии', () => {
  /** Клиент с реквизитом для рублёвой выдачи — карта тайского банка. */
  async function givenClientWithCard(core: ReturnType<typeof createCore>): Promise<string> {
    await core.registerClient({ telegramUserId: 100n, username: 'elfuerte' });
    const requisites = await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Kasikornbank',
      cardNumber: '4111111111111111',
    });
    return requisites.id;
  }

  it('записывает выдачу, посчитанную с комиссией', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    await givenServiceSettings({ minExchangeAmount: '100' });
    const core = createCore({
      db,
      rateSource: givenRates(RATES),
      requisites: {
        publicKey: testRequisiteKeys.publicKey,
        privateKey: testRequisiteKeys.privateKey,
      },
    });
    const requisitesId = await givenClientWithCard(core);

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '100000',
      requisitesId,
    });

    // Та же тысяча долларов: комиссия 45, остаётся 955, выдача 28 650 ฿.
    // Заявка — обязательство, и записанное в ней должно совпадать с
    // тем, что видел клиент.
    expect(request.toAmount).toBe('28650');
  });

  it('меряет минимальную сумму долларовым эквивалентом', async () => {
    // Порог задан в USDT, а у пары «рубли — баты» его нет ни с одной
    // стороны: без этого правила заявку можно было подать на полсотни
    // рублей.
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    await givenServiceSettings({ minExchangeAmount: '100' });
    const core = createCore({
      db,
      rateSource: givenRates(RATES),
      requisites: {
        publicKey: testRequisiteKeys.publicKey,
        privateKey: testRequisiteKeys.privateKey,
      },
    });
    const requisitesId = await givenClientWithCard(core);

    // 5 000 ₽ — это 50 $ при пороге в сотню.
    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'RUB',
        toCode: 'THB',
        fromAmount: '5000',
        requisitesId,
      }),
    ).rejects.toThrow(/Минимальная сумма/);
  });

  it('берёт ставку того способа, которым уйдут деньги по реквизиту', async () => {
    // Карта — банковский перевод, кошелёк — кошельковая ставка. Клиент
    // способ не называет: его говорит запись, на которую придут деньги.
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'wallet', tiers: WALLET_TIERS });
    await givenServiceSettings({ minExchangeAmount: '100' });
    const core = createCore({
      db,
      rateSource: givenRates(RATES),
      requisites: {
        publicKey: testRequisiteKeys.publicKey,
        privateKey: testRequisiteKeys.privateKey,
      },
    });
    const requisitesId = await givenClientWithCard(core);

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '100000',
      requisitesId,
    });

    // Банковская ставка (4,5%), а не кошельковая (5,5%): деньги идут на
    // карту.
    expect(request.toAmount).toBe('28650');
  });
});
