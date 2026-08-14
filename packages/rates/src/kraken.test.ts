import { describe, expect, it } from 'vitest';
import { createKrakenRateSource } from './kraken.js';

/**
 * Разбор ответа Kraken и выбор стороны стакана.
 *
 * Кэш здесь не проверяется: он общий со всеми провайдерами и проверен
 * на нём самом. Здесь — то, чем этот источник отличается от соседних.
 */

/**
 * Живой ответ биржи, записанный 14 августа 2026 запросом
 * `0/public/Ticker?pair=USDTZUSD,USDTEUR`. Не сочинён: тест, написанный
 * по памяти о формате, проверяет представление о провайдере, а не
 * провайдера. Числа биржа отдаёт строками, а стороны стакана —
 * массивами `[цена, лот, объём]`; так они здесь и стоят.
 */
const LIVE_RESPONSE = {
  error: [],
  result: {
    USDTEUR: {
      a: ['0.86500000', '483395', '483395.000'],
      b: ['0.86490000', '290784', '290784.000'],
      c: ['0.86490000', '169.14322812'],
      v: ['19377386.76655310', '48287816.08591393'],
      p: ['0.86524365', '0.86578158'],
      t: [3220, 8791],
      l: ['0.86450000', '0.86450000'],
      h: ['0.86640000', '0.86700000'],
      o: '0.86630000',
    },
    USDTZUSD: {
      a: ['0.99891000', '377103', '377103.000'],
      b: ['0.99890000', '136296', '136296.000'],
      c: ['0.99890000', '9999.00000000'],
      v: ['43025684.26517611', '152698045.39969501'],
      p: ['0.99894320', '0.99893058'],
      t: [7361, 20629],
      l: ['0.99884000', '0.99878000'],
      h: ['0.99904000', '0.99904000'],
      o: '0.99901000',
    },
  },
};

function givenResponse(body: unknown, ok = true) {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    } as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('курс доллара и евро у Kraken', () => {
  it('называет цену спроса, потому что USDT сервис продаёт', async () => {
    // Чтобы выдать клиенту доллары, сервис продаёт USDT, а продающий
    // получает по спросу. Последняя сделка и средняя за сутки тут ни
    // при чём: по ним сервису никто ничего не должен.
    const { fetch } = givenResponse(LIVE_RESPONSE);
    const source = createKrakenRateSource({ fetch });

    expect((await source.quote({ fromCode: 'USDT', toCode: 'USD' }))?.rate).toBe('0.9989');
    expect((await source.quote({ fromCode: 'USDT', toCode: 'EUR' }))?.rate).toBe('0.8649');
  });

  it('обратное направление считает от цены предложения', async () => {
    // Здесь сервис USDT покупал бы, а покупающий платит по предложению.
    const { fetch } = givenResponse(LIVE_RESPONSE);
    const source = createKrakenRateSource({ fetch });

    // 1 / 0,99891 — с той же точностью, с какой считают деньги:
    // восемнадцать знаков, хвост отброшен вниз.
    expect((await source.quote({ fromCode: 'USD', toCode: 'USDT' }))?.rate).toBe(
      '1.001091189396442121',
    );
  });

  it('спрашивает обе пары одним запросом', async () => {
    // Пары названы так, как их зовёт сама биржа: доллар у неё
    // `USDTZUSD`, а не `USDTUSD`, и склейка кодов ушла бы в никуда.
    const { fetch, calls } = givenResponse(LIVE_RESPONSE);
    const source = createKrakenRateSource({ fetch });

    await source.quote({ fromCode: 'USDT', toCode: 'USD' });
    await source.quote({ fromCode: 'USDT', toCode: 'EUR' });

    expect(calls).toEqual(['https://api.kraken.com/0/public/Ticker?pair=USDTZUSD%2CUSDTEUR']);
  });

  it('молчит о чужой паре, не сходив в сеть', async () => {
    // Бат и юань спрашивают у соседей по цепочке, а рубля у этой биржи
    // нет вовсе. Поход в сеть за таким вопросом — это чужое ожидание,
    // оплаченное клиентом.
    const { fetch, calls } = givenResponse(LIVE_RESPONSE);
    const source = createKrakenRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
    expect(await source.quote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('считает отказ молчанием, а не пустым списком пар', async () => {
    // Незнакомую пару биржа отвергает кодом 200: непустой `error` и
    // никакого `result`. Принятый за удачный ответ, он застыл бы в кэше
    // на весь срок его жизни.
    const { fetch } = givenResponse({ error: ['EQuery:Unknown asset pair'] });
    const source = createKrakenRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'USD' })).toBeNull();
  });

  it('считает отказом ответ без списка котировок', async () => {
    const { fetch } = givenResponse({ error: [], result: null });
    const source = createKrakenRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'USD' })).toBeNull();
  });

  it('молчит, когда биржа отвечает отказом', async () => {
    const { fetch } = givenResponse(LIVE_RESPONSE, false);
    const source = createKrakenRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'USD' })).toBeNull();
  });

  it('переживает испорченную цену в чужом ответе', async () => {
    // Строка, которая не число, роняла бы разбор целиком: `Money` на
    // такой бросает, и весь ответ превратился бы в молчание биржи — то
    // есть курс пропал бы и у второй пары из-за одного мусорного поля.
    const { fetch } = givenResponse({
      error: [],
      result: {
        USDTZUSD: { a: ['0.99891000'], b: ['n/a'] },
        USDTEUR: { a: ['0.86500000'], b: ['0.86490000'] },
      },
    });
    const source = createKrakenRateSource({ fetch });

    // Испорченная пара молчит: неполной цене верить нельзя.
    expect(await source.quote({ fromCode: 'USDT', toCode: 'USD' })).toBeNull();
    // Соседняя при этом прочитана — значит разбор не рухнул.
    expect((await source.quote({ fromCode: 'USDT', toCode: 'EUR' }))?.rate).toBe('0.8649');
  });

  it('пропускает пару с нулевой ценой', async () => {
    // Ноль — это не цена. Пропущенная пара означает «курса нет», и
    // клиент увидит честное «курс назовёт менеджер».
    const { fetch } = givenResponse({
      error: [],
      result: { USDTZUSD: { a: ['0'], b: ['0'] }, USDTEUR: LIVE_RESPONSE.result.USDTEUR },
    });
    const source = createKrakenRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'USD' })).toBeNull();
  });
});
