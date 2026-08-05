import { describe, expect, it } from 'vitest';
import { createFiatRateSource } from './fiat.js';

/**
 * Кросс-курс через доллар и то, чего фиатный источник не котирует.
 *
 * Кэш здесь не проверяется: он общий с биржей и проверен на ней. Здесь
 * — только разбор ответа и арифметика моста, то есть ровно то, чем этот
 * источник отличается от соседнего.
 */

/** Ответ провайдера: сколько единиц валюты дают за один доллар. */
function givenRates(rates: Record<string, number>) {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ base: 'USD', date: '2026-08-04', rates }),
    } as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('курс валюты к USDT', () => {
  it('берётся долларовым, потому что USDT — доллар', async () => {
    const { fetch } = givenRates({ THB: 33.335 });
    const source = createFiatRateSource({ fetch });

    const quote = await source.quote({ fromCode: 'USDT', toCode: 'THB' });

    expect(quote?.rate).toBe('33.335');
  });

  it('доллар за доллар равен единице, а не отсутствует', async () => {
    // Провайдер опорную валюту в ответе не присылает: она и есть
    // единица. Без неё направление USDT → USD осталось бы без курса.
    const { fetch } = givenRates({ THB: 33.335 });
    const source = createFiatRateSource({ fetch });

    expect((await source.quote({ fromCode: 'USDT', toCode: 'USD' }))?.rate).toBe('1');
  });

  it('считается через доллар, когда его нет ни с одной стороны', async () => {
    const { fetch } = givenRates({ THB: 33.335, EUR: 0.868 });
    const source = createFiatRateSource({ fetch });

    const quote = await source.quote({ fromCode: 'EUR', toCode: 'THB' });

    // 33,335 бата за доллар при 0,868 евро за доллар — 38,40 бата за
    // евро; посчитано вручную.
    expect(quote?.rate).toBe('38.404377880184331797');
  });
});

/**
 * Разделение труда между источниками: рубля у ЕЦБ нет с 2022 года, и
 * рублёвые направления должны молча уйти к бирже, а не получить здесь
 * выдуманную цену.
 */
describe('валюта, которой провайдер не знает', () => {
  it('остаётся без курса', async () => {
    const { fetch } = givenRates({ THB: 33.335 });
    const source = createFiatRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
  });
});

describe('недоступность провайдера', () => {
  it('оборачивается пустой котировкой, а не ошибкой', async () => {
    const fetch = (async () => {
      throw new Error('сеть недоступна');
    }) as typeof globalThis.fetch;
    const source = createFiatRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
  });

  it('то же при отказе самого провайдера', async () => {
    const fetch = (async () => ({ ok: false, status: 503 }) as Response) as typeof globalThis.fetch;
    const source = createFiatRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
  });
});
