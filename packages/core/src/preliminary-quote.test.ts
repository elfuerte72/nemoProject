import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type RatePair, type RateQuote, type RateSource } from './index.js';
import { asClient, givenCurrencyPair } from './test-support.js';

/**
 * Предварительный курс для электронных переводов.
 *
 * Курс справочный: он показывает клиенту порядок суммы, а финальный
 * называет менеджер (docs/adr/0004). Поэтому ни одна проверка здесь не
 * требует, чтобы заявка исполнилась по показанному курсу, — зато
 * требует, чтобы отсутствие курса не мешало её подать.
 */

/** Источник, отвечающий заданной котировкой. Считает обращения к себе. */
function givenRateSource(rate: string | null): RateSource & { calls: RatePair[] } {
  const calls: RatePair[] = [];
  return {
    calls,
    async quote(pair: RatePair): Promise<RateQuote | null> {
      calls.push(pair);
      return rate === null
        ? null
        : { rate: rate as RateQuote['rate'], asOf: new Date('2026-01-01T00:00:00Z') };
    },
  };
}

const db = testDatabase();

beforeEach(async () => {
  await resetDatabase();
  await db.execute('select 1');
});

afterAll(() => closeTestDatabase());

describe('электронный перевод', () => {
  it('пересчитывает сумму по котировке с наценкой направления', async () => {
    await givenCurrencyPair({
      fromCode: 'USDT',
      toCode: 'RUB',
      kind: 'electronic',
      markupBps: 200,
    });
    const core = createCore({ db, rateSource: givenRateSource('100') });

    const quote = await core.getPreliminaryQuote({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '10',
    });

    // Наценка 2% от котировки 100 — курс 98, за 10 USDT дадут 980.
    // Посчитано вручную от правила, а не тем же выражением, что в коде.
    expect(quote).toMatchObject({ rate: '98', toAmount: '980', markupBps: 200 });
  });

  it('берёт наценку из справочника направлений, а не из кода', async () => {
    await givenCurrencyPair({
      fromCode: 'USDT',
      toCode: 'RUB',
      kind: 'electronic',
      markupBps: 1000,
    });
    const core = createCore({ db, rateSource: givenRateSource('100') });

    const quote = await core.getPreliminaryQuote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(quote?.rate).toBe('90');
  });

  it('отдаёт курс и без суммы: клиент ещё ничего не ввёл', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', markupBps: 0 });
    const core = createCore({ db, rateSource: givenRateSource('95.5') });

    const quote = await core.getPreliminaryQuote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(quote).toMatchObject({ rate: '95.5', toAmount: null });
  });
});

describe('наличные', () => {
  it('котировку не запрашивают: ставку называет менеджер', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    const source = givenRateSource('100');
    const core = createCore({ db, rateSource: source });

    const quote = await core.getPreliminaryQuote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(quote).toBeNull();
    expect(source.calls).toEqual([]);
  });
});

describe('недоступность провайдера', () => {
  it('оставляет клиента без курса, но не без заявки', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    const core = createCore({ db, rateSource: givenRateSource(null) });
    await core.registerClient({ telegramUserId: 100n });
    const requisites = await core.saveRequisites(asClient(100n), { phone: '+79990000000' });

    expect(await core.getPreliminaryQuote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId: requisites.id,
    });
    expect(request.status).toBe('new');
    expect(request.preliminaryRate).toBeNull();
  });

  it('то же, когда источник курса вовсе не настроен', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    const core = createCore({ db });

    expect(await core.getPreliminaryQuote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
  });
});

describe('неактивное направление', () => {
  it('курса не имеет', async () => {
    await givenCurrencyPair({
      fromCode: 'USDT',
      toCode: 'RUB',
      kind: 'electronic',
      isActive: false,
    });
    const core = createCore({ db, rateSource: givenRateSource('100') });

    expect(await core.getPreliminaryQuote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
  });
});

describe('поданная заявка', () => {
  it('запоминает курс на момент подачи — от чего отталкивался клиент', async () => {
    await givenCurrencyPair({
      fromCode: 'USDT',
      toCode: 'RUB',
      kind: 'electronic',
      markupBps: 200,
    });
    const core = createCore({ db, rateSource: givenRateSource('100') });
    await core.registerClient({ telegramUserId: 100n });
    const requisites = await core.saveRequisites(asClient(100n), { phone: '+79990000000' });

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '10',
      requisitesId: requisites.id,
    });

    expect(request.preliminaryRate).toBe('98');
  });

  it('наличными идёт без курса вовсе', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    const source = givenRateSource('100');
    const core = createCore({ db, rateSource: source });
    await core.registerClient({ telegramUserId: 100n });

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '10',
    });

    expect(request.preliminaryRate).toBeNull();
    expect(source.calls).toEqual([]);
  });
});
