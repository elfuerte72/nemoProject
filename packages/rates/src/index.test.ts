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

/**
 * Пересчёт через опорную валюту убран вместе с парой, ради которой
 * существовал: USDT и рубль биржа котирует напрямую, а других валют у
 * сервиса нет. Проверяется поэтому обратное — что цена, собранная из
 * двух котировок, за настоящую не выдаётся.
 */
describe('пара, которой биржа не котирует', () => {
  it('остаётся без курса, даже когда обе половины цены известны', async () => {
    const { fetch } = givenRapira([
      { symbol: 'USDT/RUB', close: 80 },
      { symbol: 'BTC/USDT', close: 60000 },
    ]);
    const source = createRapiraRateSource({ fetch });

    expect(await source.quote({ fromCode: 'BTC', toCode: 'RUB' })).toBeNull();
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

/**
 * Главное свойство источника: за курсом он ходит, но ждать себя не
 * заставляет. Пока обновление стояло в пути ответа, каждое устаревание
 * оборачивалось секундами ожидания у того, кто в это устаревание попал.
 */
describe('обновление в фоне', () => {
  it('отдаёт устаревшее сразу, не дожидаясь биржи', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      // Первый ответ мгновенный, второй висит, пока его не отпустят.
      if (calls > 1) await held;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ symbol: 'USDT/RUB', close: calls === 1 ? 95 : 96 }] }),
      } as Response;
    }) as typeof globalThis.fetch;

    let clock = 0;
    const source = createRapiraRateSource({ fetch, now: () => clock, ttlMs: 1000 });

    await source.quote({ fromCode: 'USDT', toCode: 'RUB' });
    clock = 1001;

    // Биржа висит — а ответ приходит, и приходит прежним курсом.
    const stale = await source.quote({ fromCode: 'USDT', toCode: 'RUB' });
    expect(stale?.rate).toBe('95');
    expect(calls).toBe(2);

    // Отпускаем биржу и даём фоновому обновлению доиграть: оно идёт
    // цепочкой обещаний, и одного оборота очереди задач ей мало.
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fresh = await source.quote({ fromCode: 'USDT', toCode: 'RUB' });
    expect(fresh?.rate).toBe('96');
  });

  it('молчание биржи не стирает известный курс', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      if (calls > 1) throw new Error('соединение оборвалось');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ symbol: 'USDT/RUB', close: 95 }] }),
      } as Response;
    }) as typeof globalThis.fetch;

    let clock = 0;
    const source = createRapiraRateSource({ fetch, now: () => clock, ttlMs: 1000 });

    await source.quote({ fromCode: 'USDT', toCode: 'RUB' });
    clock = 1001;

    expect((await source.quote({ fromCode: 'USDT', toCode: 'RUB' }))?.rate).toBe('95');
  });

  it('но не показывает курс, устаревший до бессмысленности', async () => {
    const { fetch } = givenRapira([{ symbol: 'USDT/RUB', close: 95 }]);
    let clock = 0;
    const source = createRapiraRateSource({
      fetch,
      now: () => clock,
      ttlMs: 1000,
      maxAgeMs: 5000,
    });

    await source.quote({ fromCode: 'USDT', toCode: 'RUB' });
    clock = 5001;

    // По такому курсу подают заявку, а она обязательство сервиса:
    // лучше сказать, что курса нет, чем назвать вчерашний.
    expect(await source.quote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
  });
});

/**
 * Клиент подаёт заявку по курсу, который увидел, и присылает отметку его
 * времени. Спрошенный заново курс успевал бы обновиться между взглядом и
 * нажатием — человек соглашался бы на одно число, а получал другое.
 */
describe('курс по отметке времени', () => {
  it('возвращает тот же курс, что был показан', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ symbol: 'USDT/RUB', close: calls === 1 ? 95 : 99 }] }),
      } as Response;
    }) as typeof globalThis.fetch;

    let clock = 0;
    const source = createRapiraRateSource({ fetch, now: () => clock, ttlMs: 1000 });

    const shown = await source.quote({ fromCode: 'USDT', toCode: 'RUB' });
    clock = 1001;
    await source.quote({ fromCode: 'USDT', toCode: 'RUB' });
    clock = 1002;
    await source.quote({ fromCode: 'USDT', toCode: 'RUB' });

    const submitted = await source.quote({ fromCode: 'USDT', toCode: 'RUB' }, shown?.asOf);
    expect(submitted?.rate).toBe('95');
  });

  it('незнакомую отметку заменяет текущим курсом, а не отказом', async () => {
    const { fetch } = givenRapira([{ symbol: 'USDT/RUB', close: 95 }]);
    const source = createRapiraRateSource({ fetch });

    const quote = await source.quote({ fromCode: 'USDT', toCode: 'RUB' }, new Date(0));

    expect(quote?.rate).toBe('95');
  });
});
