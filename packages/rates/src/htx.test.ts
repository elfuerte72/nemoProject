import { describe, expect, it } from 'vitest';
import { createHtxRateSource } from './htx.js';

/**
 * Разбор красного стакана HTX: сторона, фильтр по объёму заявки и
 * средняя по верхушке.
 *
 * Кэш здесь не проверяется — он общий со всеми провайдерами и проверен
 * на нём самом. Здесь то, чем этот источник отличается от соседних: у
 * него не одна цена в ответе, а стакан, из которого цену ещё надо
 * собрать по правилу владельца.
 */

/**
 * Живой ответ раздела, записанный 14 августа 2026 запросом
 * `otc/v1/data/trade-market` со стороной `buy` и `amount=1000`. Не
 * сочинён: тест, написанный по памяти о формате, проверяет
 * представление о провайдере, а не провайдера. Полей у объявления два
 * десятка, оставлены читаемые — цена и границы лота; числа приходят
 * строками, так они здесь и стоят.
 */
const LIVE_OFFERS = [
  { price: '6.66', minTradeLimit: '1000.00', maxTradeLimit: '10000.00' },
  { price: '6.66', minTradeLimit: '1000.00', maxTradeLimit: '1330.00' },
  { price: '6.65', minTradeLimit: '1000.00', maxTradeLimit: '1295047.00' },
  { price: '6.65', minTradeLimit: '1000.00', maxTradeLimit: '882444.00' },
  { price: '6.65', minTradeLimit: '1000.00', maxTradeLimit: '100000.00' },
  { price: '6.65', minTradeLimit: '1000.00', maxTradeLimit: '50000.00' },
  { price: '6.65', minTradeLimit: '1000.00', maxTradeLimit: '10000.00' },
];

/**
 * Тот же стакан, спрошенный без фильтра, — записан тогда же. Верх его
 * занимают лоты от 33 000 юаней, и цена у них своя: 6,68 против 6,65.
 * Так выглядел бы ответ, если бы раздел проигнорировал `amount`.
 */
const UNFILTERED_OFFERS = [
  { price: '6.68', minTradeLimit: '50000.00', maxTradeLimit: '603971.00' },
  { price: '6.68', minTradeLimit: '50000.00', maxTradeLimit: '1093017.00' },
  { price: '6.68', minTradeLimit: '50000.00', maxTradeLimit: '1022400.00' },
  { price: '6.68', minTradeLimit: '33000.00', maxTradeLimit: '500000.00' },
  { price: '6.68', minTradeLimit: '35000.00', maxTradeLimit: '600000.00' },
  { price: '6.68', minTradeLimit: '100000.00', maxTradeLimit: '2600000.00' },
];

const LIVE_RESPONSE = {
  code: 200,
  message: 'Success',
  totalCount: 282,
  pageSize: 10,
  currPage: 1,
  data: LIVE_OFFERS,
  success: true,
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

/** Раздел, отвечающий на каждую страницу своим списком объявлений. */
function givenPages(pages: readonly (readonly unknown[])[]) {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    const address = String(url);
    calls.push(address);
    const page = Number(new URL(address).searchParams.get('currPage') ?? '1');
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 200, data: pages[page - 1] ?? [] }),
    } as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('курс юаня по красному стакану HTX', () => {
  it('усредняет пять верхних объявлений', async () => {
    // (6,66 + 6,66 + 6,65 + 6,65 + 6,65) / 5. Шестое и седьмое не в
    // счёт: правило владельца называет пять.
    const { fetch } = givenResponse(LIVE_RESPONSE);
    const source = createHtxRateSource({ fetch });

    expect((await source.quote({ fromCode: 'USDT', toCode: 'CNY' }))?.rate).toBe('6.654');
  });

  it('берёт сторону, по которой сервис продаёт USDT', async () => {
    // Чтобы выдать клиенту юани, сервис продаёт USDT, а продающий
    // получает по спросу. У HTX эта сторона названа со стороны
    // мерчанта — покупает он, — и стоит она на полпроцента дешевле
    // встречной. Взятая не та сторона означала бы, что сервис выдаёт
    // юаней больше, чем купил.
    const { fetch, calls } = givenResponse(LIVE_RESPONSE);
    const source = createHtxRateSource({ fetch });

    await source.quote({ fromCode: 'USDT', toCode: 'CNY' });

    expect(calls[0]).toContain('tradeType=buy');
  });

  it('пропускает лоты, которых фильтр стакана не касается', async () => {
    // Так выглядит ответ, если раздел проигнорировал `amount`: верх
    // занят лотами от 33 000 юаней по своей цене. Приняв их, сервис
    // считал бы юань по 6,68 вместо 6,65 — полпроцента из своего
    // кармана на каждой заявке. Здесь крупняк отсеян, и в счёт идут
    // пять подходящих со следующей страницы.
    const { fetch } = givenPages([UNFILTERED_OFFERS, LIVE_OFFERS]);
    const source = createHtxRateSource({ fetch });

    expect((await source.quote({ fromCode: 'USDT', toCode: 'CNY' }))?.rate).toBe('6.654');
  });

  it('пропускает лот, на котором тысячи юаней не наберётся', async () => {
    // Вторая граница того же правила: по лоту до пятисот юаней сделку
    // на тысячу не совершить. Здесь первое объявление отсеяно, и в счёт
    // идут пять следующих: (6,66 + 6,65 + 6,65 + 6,65 + 6,65) / 5.
    const { fetch } = givenResponse({
      code: 200,
      data: [
        { price: '6.50', minTradeLimit: '10.00', maxTradeLimit: '500.00' },
        ...LIVE_OFFERS.slice(1),
      ],
    });
    const source = createHtxRateSource({ fetch });

    expect((await source.quote({ fromCode: 'USDT', toCode: 'CNY' }))?.rate).toBe('6.652');
  });

  it('добирает пятёрку со следующей страницы', async () => {
    // Раздел отдаёт по десять объявлений и `pageSize` в запросе
    // игнорирует. Если подходящих на первой странице меньше пяти,
    // источник замолчал бы — и юань молча вернулся бы к опорному курсу
    // банка.
    const { fetch, calls } = givenPages([LIVE_OFFERS.slice(0, 3), LIVE_OFFERS.slice(3)]);
    const source = createHtxRateSource({ fetch });

    // (6,66 + 6,66 + 6,65) с первой страницы и (6,65 + 6,65) со второй.
    expect((await source.quote({ fromCode: 'USDT', toCode: 'CNY' }))?.rate).toBe('6.654');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('currPage=2');
  });

  it('не листает дальше, когда пятёрка набралась', async () => {
    // Лишний запрос в недоговорный адрес не нужен: на первой странице
    // подходящих обычно все десять.
    const { fetch, calls } = givenPages([LIVE_OFFERS, LIVE_OFFERS]);
    const source = createHtxRateSource({ fetch });

    await source.quote({ fromCode: 'USDT', toCode: 'CNY' });

    expect(calls).toHaveLength(1);
  });

  it('молчит, когда подходящих объявлений меньше пяти', async () => {
    // Средняя по трём лотам случайна: столько их бывает, когда раздел
    // отдал не то. Честнее отдать пару следующему в цепочке — клиент
    // увидит курс ЕЦБ, а не выдумку.
    const { fetch } = givenPages([LIVE_OFFERS.slice(0, 3), []]);
    const source = createHtxRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'CNY' })).toBeNull();
  });

  it('считает пустой список отказом, а не отсутствием цены', async () => {
    // Так раздел отвечает на запрос, который ему не понравился: код 200
    // и пустой `data`. Принятый за удачный ответ, он застыл бы в кэше на
    // весь срок его жизни.
    const { fetch } = givenResponse({ code: 200, message: 'Success', data: [], success: true });
    const source = createHtxRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'CNY' })).toBeNull();
  });

  it('молчит, когда раздел отвечает отказом', async () => {
    const { fetch } = givenResponse(LIVE_RESPONSE, false);
    const source = createHtxRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'CNY' })).toBeNull();
  });

  it('переживает испорченную цену в чужом ответе', async () => {
    // Строка, которая не число, роняла бы разбор целиком: `Money` на
    // такой бросает, и весь стакан превратился бы в молчание раздела.
    // Здесь испорченное объявление пропущено, а счёт идёт по пяти
    // следующим.
    const { fetch } = givenResponse({
      code: 200,
      data: [
        { price: 'n/a', minTradeLimit: '1000.00', maxTradeLimit: '5000.00' },
        ...LIVE_OFFERS.slice(1),
      ],
    });
    const source = createHtxRateSource({ fetch });

    expect((await source.quote({ fromCode: 'USDT', toCode: 'CNY' }))?.rate).toBe('6.652');
  });

  it('пропускает объявление без границ лота', async () => {
    // Без них нельзя сказать, можно ли по нему совершить сделку на
    // тысячу, — а правило владельца именно про это.
    const { fetch } = givenResponse({
      code: 200,
      data: [{ price: '6.50' }, ...LIVE_OFFERS.slice(1)],
    });
    const source = createHtxRateSource({ fetch });

    expect((await source.quote({ fromCode: 'USDT', toCode: 'CNY' }))?.rate).toBe('6.652');
  });

  it('не называет обратной пары', async () => {
    // Спрошена одна сторона стакана — та, по которой сервис продаёт
    // USDT. Приём юаней сервис не торгует, и выводить цену встречной
    // стороны из этой значило бы назвать курс, которого никто не давал.
    const { fetch } = givenResponse(LIVE_RESPONSE);
    const source = createHtxRateSource({ fetch });

    expect(await source.quote({ fromCode: 'CNY', toCode: 'USDT' })).toBeNull();
  });

  it('о чужих парах молчит, не сходив в сеть', async () => {
    // Стакан спрошен про юань. Бат и рубль знают соседи по цепочке, а
    // запрос ради заведомого «нет» — это лишний стук в недоговорный
    // адрес.
    const { fetch, calls } = givenResponse(LIVE_RESPONSE);
    const source = createHtxRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('спрашивает юаневый стакан с фильтром от тысячи', async () => {
    // Монета и валюта — внутренние номера HTX, взятые из её же
    // справочников: USDT это монета 2, юань — валюта 172.
    const { fetch, calls } = givenResponse(LIVE_RESPONSE);
    const source = createHtxRateSource({ fetch });

    await source.quote({ fromCode: 'USDT', toCode: 'CNY' });

    const [url] = calls;
    expect(url).toContain('https://www.htx.com/-/x/otc/v1/data/trade-market?');
    expect(url).toContain('coinId=2');
    expect(url).toContain('currency=172');
    expect(url).toContain('amount=1000');
  });
});
