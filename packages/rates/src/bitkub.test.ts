import { describe, expect, it } from 'vitest';
import { createBitkubRateSource } from './bitkub.js';

/**
 * Разбор ответа тайской биржи и выбор стороны стакана.
 *
 * Кэш здесь не проверяется: он общий со всеми провайдерами и проверен
 * на нём самом. Здесь — то, чем этот источник отличается от соседних.
 */

/**
 * Живой ответ биржи, записанный 12 августа 2026 запросом
 * `api/v3/market/ticker?sym=USDT_THB`. Не сочинён: тест, написанный по
 * памяти о формате, проверяет представление о провайдере, а не
 * провайдера. Числа биржа отдаёт строками — так они здесь и стоят.
 */
const LIVE_RESPONSE = [
  {
    symbol: 'USDT_THB',
    base_volume: '14797431.54',
    high_24_hr: '33.14',
    highest_bid: '33.07',
    last: '33.08',
    low_24_hr: '33.06',
    lowest_ask: '33.08',
    percent_change: '-0.09',
    quote_volume: '489706985.08',
  },
];

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

describe('курс бата у тайской биржи', () => {
  it('называет цену спроса, потому что USDT сервис продаёт', async () => {
    // Чтобы выдать клиенту баты, сервис продаёт USDT, а продающий
    // получает по спросу. Последняя сделка (33,08) тут ни при чём: по
    // ней сервису никто ничего не должен.
    const { fetch } = givenResponse(LIVE_RESPONSE);
    const source = createBitkubRateSource({ fetch });

    expect((await source.quote({ fromCode: 'USDT', toCode: 'THB' }))?.rate).toBe('33.07');
  });

  it('обратное направление считает от цены предложения', async () => {
    // Здесь сервис USDT покупал бы, а покупающий платит по предложению.
    const { fetch } = givenResponse(LIVE_RESPONSE);
    const source = createBitkubRateSource({ fetch });

    const quote = await source.quote({ fromCode: 'THB', toCode: 'USDT' });

    // 1 / 33,08 — с той же точностью, с какой считают деньги:
    // восемнадцать знаков, хвост отброшен вниз.
    expect(quote?.rate).toBe('0.03022974607013301');
  });

  it('молчит о паре, которой у биржи нет', async () => {
    // Юаня у тайской биржи не бывает, и выдумывать его нечем.
    const { fetch } = givenResponse(LIVE_RESPONSE);
    const source = createBitkubRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'CNY' })).toBeNull();
  });

  it('считает отказ молчанием, а не пустым списком пар', async () => {
    // Старый путь без `v3` отвечает объектом с полем `error` и кодом
    // 200. Приняв его за удачный ответ, кэш заполнился бы пустотой и
    // держал бы её до следующего обновления — то есть биржа замолчала
    // бы на десять секунд после каждой такой ошибки.
    const { fetch } = givenResponse({ error: 99, result: null });
    const source = createBitkubRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
  });

  it('молчит, когда биржа отвечает отказом', async () => {
    const { fetch } = givenResponse(LIVE_RESPONSE, false);
    const source = createBitkubRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
  });

  it('спрашивает одну пару, а не весь список', async () => {
    // Полный ответ биржи — 96 килобайт на сто с лишним пар при
    // обновлении раз в десять секунд. Нужная из них одна.
    const { fetch, calls } = givenResponse(LIVE_RESPONSE);
    const source = createBitkubRateSource({ fetch });

    await source.quote({ fromCode: 'USDT', toCode: 'THB' });

    expect(calls).toEqual(['https://api.bitkub.com/api/v3/market/ticker?sym=USDT_THB']);
  });

  it('переживает нечисловую цену в чужом ответе', async () => {
    // Строка, которая не число, роняла разбор целиком: `Money` на такой
    // бросает, и весь ответ превращался в молчание биржи — то есть курс
    // пропадал у всех из-за одного мусорного поля.
    const { fetch } = givenResponse([
      { symbol: 'USDT_THB', highest_bid: 'n/a', lowest_ask: '33.08' },
      { symbol: 'BTC_THB', highest_bid: '2100000', lowest_ask: '2100100' },
    ]);
    const source = createBitkubRateSource({ fetch });

    // Испорченная пара молчит: неполной цене верить нельзя.
    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
    // Соседняя строка при этом прочитана — значит разбор не рухнул.
    expect((await source.quote({ fromCode: 'BTC', toCode: 'THB' }))?.rate).toBe('2100000');
  });

  it('считает пустой список отказом', async () => {
    // Так биржа отвечает на незнакомую пару. Принятый за удачный ответ,
    // он застыл бы в кэше на весь срок его жизни.
    const { fetch } = givenResponse([]);
    const source = createBitkubRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
  });

  it('пропускает строку с испорченной ценой', async () => {
    // Ноль и пустая строка — это не цена. Пропущенная строка означает
    // «пары нет», и клиент увидит честное «курс назовёт менеджер».
    const { fetch } = givenResponse([
      { symbol: 'USDT_THB', highest_bid: '0', lowest_ask: '33.08' },
    ]);
    const source = createBitkubRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
  });
});
