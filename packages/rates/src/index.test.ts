import { describe, expect, it } from 'vitest';
import { createRapiraRateSource } from './index.js';

/**
 * Разбор ответа Rapira и кэш котировок.
 *
 * Проверяется здесь, а не через операции ядра: правила «пара котируется
 * в обратную сторону» и «за курсом ходят не чаще раза в интервал» —
 * свойства самого источника, и сеть для них не нужна.
 */

interface Rate {
  symbol: string;
  close: number;
}

/** Ответ Rapira и счётчик обращений к ней. */
function givenRapira(rates: Rate[]) {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: rates, code: 200 }),
    } as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('котировка пары', () => {
  it('берётся из ответа биржи как есть', async () => {
    const { fetch } = givenRapira([{ symbol: 'USDT/RUB', close: 95.5 }]);
    const source = createRapiraRateSource({ fetch });

    const quote = await source.quote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(quote?.rate).toBe('95.5');
  });

  it('переворачивается, если биржа котирует пару в другую сторону', async () => {
    const { fetch } = givenRapira([{ symbol: 'USDT/RUB', close: 100 }]);
    const source = createRapiraRateSource({ fetch });

    const quote = await source.quote({ fromCode: 'RUB', toCode: 'USDT' });

    // За рубль дают одну сотую доллара: 1 / 100, посчитано вручную.
    expect(quote?.rate).toBe('0.01');
  });

  it('пуста, когда такой пары у биржи нет', async () => {
    const { fetch } = givenRapira([{ symbol: 'BTC/USDT', close: 62502 }]);
    const source = createRapiraRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
  });
});

describe('недоступность провайдера', () => {
  it('оборачивается пустой котировкой, а не ошибкой', async () => {
    const fetch = (async () => {
      throw new Error('сеть недоступна');
    }) as typeof globalThis.fetch;
    const source = createRapiraRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
  });

  it('то же при отказе самой биржи', async () => {
    const fetch = (async () => ({ ok: false, status: 503 }) as Response) as typeof globalThis.fetch;
    const source = createRapiraRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
  });
});

describe('кэш', () => {
  it('избавляет от запроса на каждую введённую цифру', async () => {
    const { fetch, calls } = givenRapira([{ symbol: 'USDT/RUB', close: 95 }]);
    let clock = 0;
    const source = createRapiraRateSource({ fetch, now: () => clock, ttlMs: 1000 });

    await source.quote({ fromCode: 'USDT', toCode: 'RUB' });
    clock = 999;
    await source.quote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(calls).toHaveLength(1);
  });

  it('устаревает: курс не должен застревать надолго', async () => {
    const { fetch, calls } = givenRapira([{ symbol: 'USDT/RUB', close: 95 }]);
    let clock = 0;
    const source = createRapiraRateSource({ fetch, now: () => clock, ttlMs: 1000 });

    await source.quote({ fromCode: 'USDT', toCode: 'RUB' });
    clock = 1001;
    await source.quote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(calls).toHaveLength(2);
  });

  it('склеивает одновременные запросы в один', async () => {
    const { fetch, calls } = givenRapira([{ symbol: 'USDT/RUB', close: 95 }]);
    const source = createRapiraRateSource({ fetch });

    await Promise.all([
      source.quote({ fromCode: 'USDT', toCode: 'RUB' }),
      source.quote({ fromCode: 'USDT', toCode: 'RUB' }),
      source.quote({ fromCode: 'USDT', toCode: 'RUB' }),
    ]);

    expect(calls).toHaveLength(1);
  });
});
