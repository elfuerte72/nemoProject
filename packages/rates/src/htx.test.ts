import { describe, expect, it } from 'vitest';
import { createHtxRateSource } from './htx.js';

/**
 * Разбор красного стакана HTX: сторона, фильтр по объёму заявки,
 * фильтр по истории мерчанта и медиана по верхушке.
 *
 * Кэш здесь не проверяется — он общий со всеми провайдерами и проверен
 * на нём самом. Здесь то, чем этот источник отличается от соседних: у
 * него не одна цена в ответе, а стакан, из которого цену ещё надо
 * собрать по правилу владельца, — и три таких стакана.
 */

/**
 * Живые ответы раздела, записанные 27 августа 2026 запросом
 * `otc/v1/data/trade-market` со стороной `buy` и `amount=1000`. Не
 * сочинены: тест, написанный по памяти о формате, проверяет
 * представление о провайдере, а не провайдера. Полей у объявления три
 * десятка, оставлены те, что читаются: цена, границы лота, процент
 * исполнения и сделки за месяц. Числа приходят так, как стоят здесь:
 * цена и границы — строками, процент — строкой, сделки — числом.
 */

/** Стакан юаня, первые восемь строк. Чистый: у всех история в сотнях сделок. */
const CNY_OFFERS = [
  { price: '6.67', minTradeLimit: '800.00', maxTradeLimit: '2000.00', orderCompleteRate: '99', tradeMonthTimes: 152 },
  { price: '6.64', minTradeLimit: '1000.00', maxTradeLimit: '1000000.00', orderCompleteRate: '97', tradeMonthTimes: 4629 },
  { price: '6.64', minTradeLimit: '1000.00', maxTradeLimit: '326481.00', orderCompleteRate: '99', tradeMonthTimes: 6449 },
  { price: '6.64', minTradeLimit: '1000.00', maxTradeLimit: '500000.00', orderCompleteRate: '99', tradeMonthTimes: 2251 },
  { price: '6.64', minTradeLimit: '1000.00', maxTradeLimit: '100000.00', orderCompleteRate: '99', tradeMonthTimes: 2314 },
  { price: '6.64', minTradeLimit: '1000.00', maxTradeLimit: '1297.00', orderCompleteRate: '95', tradeMonthTimes: 1175 },
  { price: '6.64', minTradeLimit: '1000.00', maxTradeLimit: '30000.00', orderCompleteRate: '95', tradeMonthTimes: 354 },
  { price: '6.64', minTradeLimit: '900.00', maxTradeLimit: '7000.00', orderCompleteRate: '92', tradeMonthTimes: 343 },
];

/**
 * Тот же стакан, спрошенный без фильтра по сумме, — записан тогда же.
 * Верх его занимают лоты от 30 000 юаней, и цена у них своя: 6,68
 * против 6,64. Так выглядел бы ответ, если бы раздел проигнорировал
 * `amount`. История у этих мерчантов настоящая — отсеять их должен
 * фильтр лота, а не фильтр истории.
 */
const CNY_LARGE_LOTS = [
  { price: '6.68', minTradeLimit: '50000.00', maxTradeLimit: '1195613.00', orderCompleteRate: '98', tradeMonthTimes: 1424 },
  { price: '6.68', minTradeLimit: '39000.00', maxTradeLimit: '752382.00', orderCompleteRate: '97', tradeMonthTimes: 526 },
  { price: '6.68', minTradeLimit: '50000.00', maxTradeLimit: '300000.00', orderCompleteRate: '88', tradeMonthTimes: 38 },
  { price: '6.67', minTradeLimit: '30000.00', maxTradeLimit: '666888.00', orderCompleteRate: '98', tradeMonthTimes: 521 },
  { price: '6.67', minTradeLimit: '10000.00', maxTradeLimit: '60000.00', orderCompleteRate: '94', tradeMonthTimes: 1489 },
  { price: '6.67', minTradeLimit: '50000.00', maxTradeLimit: '500000.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
];

/**
 * Стакан евро, две первые страницы. Верх занят приманками: 1,02 € за
 * USDT при 0,86 на бирже — и у всех ни сделки за месяц. Настоящие цены
 * начинаются с седьмой строки, и пятёрка с историей собирается только
 * со второй страницы.
 */
const EUR_PAGE_1 = [
  { price: '1.02', minTradeLimit: '300.00', maxTradeLimit: '204000.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '1.02', minTradeLimit: '250.00', maxTradeLimit: '100000.00', orderCompleteRate: '28', tradeMonthTimes: 2 },
  { price: '1.02', minTradeLimit: '100.00', maxTradeLimit: '4896.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '0.90', minTradeLimit: '500.00', maxTradeLimit: '77452.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '0.89', minTradeLimit: '100.00', maxTradeLimit: '32500.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '0.87', minTradeLimit: '1000.00', maxTradeLimit: '20000.00', orderCompleteRate: '33', tradeMonthTimes: 1 },
  { price: '0.87', minTradeLimit: '500.00', maxTradeLimit: '3000.00', orderCompleteRate: '95', tradeMonthTimes: 91 },
  { price: '0.87', minTradeLimit: '300.00', maxTradeLimit: '174000.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '0.86', minTradeLimit: '1000.00', maxTradeLimit: '25000.00', orderCompleteRate: '33', tradeMonthTimes: 1 },
  { price: '0.86', minTradeLimit: '500.00', maxTradeLimit: '1500.00', orderCompleteRate: '87', tradeMonthTimes: 14 },
];

const EUR_PAGE_2 = [
  { price: '0.86', minTradeLimit: '400.00', maxTradeLimit: '10000.00', orderCompleteRate: '45', tradeMonthTimes: 11 },
  { price: '0.86', minTradeLimit: '500.00', maxTradeLimit: '1500.00', orderCompleteRate: '96', tradeMonthTimes: 25 },
  { price: '0.86', minTradeLimit: '300.00', maxTradeLimit: '10000.00', orderCompleteRate: '45', tradeMonthTimes: 11 },
  { price: '0.86', minTradeLimit: '500.00', maxTradeLimit: '2000.00', orderCompleteRate: '23', tradeMonthTimes: 4 },
  { price: '0.86', minTradeLimit: '500.00', maxTradeLimit: '2000.00', orderCompleteRate: '60', tradeMonthTimes: 9 },
  { price: '0.86', minTradeLimit: '800.00', maxTradeLimit: '50000.00', orderCompleteRate: '80', tradeMonthTimes: 17 },
  { price: '0.85', minTradeLimit: '500.00', maxTradeLimit: '15000.00', orderCompleteRate: '68', tradeMonthTimes: 44 },
  { price: '0.85', minTradeLimit: '1000.00', maxTradeLimit: '41880.00', orderCompleteRate: '95', tradeMonthTimes: 79 },
  { price: '0.85', minTradeLimit: '1000.00', maxTradeLimit: '50000.00', orderCompleteRate: '89', tradeMonthTimes: 73 },
  { price: '0.85', minTradeLimit: '500.00', maxTradeLimit: '20000.00', orderCompleteRate: '68', tradeMonthTimes: 44 },
];

/**
 * Стакан доллара, три первые страницы. Здесь приманка прошла бы и
 * фильтр истории: шестая строка — 1,20 $ за USDT от мерчанта с
 * двенадцатью сделками и стопроцентным исполнением. Пятёрка с историей
 * выходит 1,20 / 1,03 / 1,00 / 0,99 / 0,99: среднее обещало бы 1,04,
 * медиана называет доллар.
 */
const USD_PAGE_1 = [
  { price: '1.20', minTradeLimit: '1000.00', maxTradeLimit: '10000.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '1.20', minTradeLimit: '100.00', maxTradeLimit: '67023.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '1.20', minTradeLimit: '300.00', maxTradeLimit: '240000.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '1.20', minTradeLimit: '250.00', maxTradeLimit: '100000.00', orderCompleteRate: '28', tradeMonthTimes: 2 },
  { price: '1.20', minTradeLimit: '150.00', maxTradeLimit: '6000.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '1.20', minTradeLimit: '70.00', maxTradeLimit: '7000.00', orderCompleteRate: '100', tradeMonthTimes: 12 },
  { price: '1.19', minTradeLimit: '500.00', maxTradeLimit: '10000.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '1.12', minTradeLimit: '600.00', maxTradeLimit: '96384.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '1.10', minTradeLimit: '100.00', maxTradeLimit: '3000.00', orderCompleteRate: '100', tradeMonthTimes: 1 },
  { price: '1.10', minTradeLimit: '200.00', maxTradeLimit: '1000.00', orderCompleteRate: '37', tradeMonthTimes: 6 },
];

const USD_PAGE_2 = [
  { price: '1.03', minTradeLimit: '50.00', maxTradeLimit: '3000.00', orderCompleteRate: '100', tradeMonthTimes: 20 },
  { price: '1.01', minTradeLimit: '220.00', maxTradeLimit: '50013.00', orderCompleteRate: '76', tradeMonthTimes: 19 },
  { price: '1.01', minTradeLimit: '500.00', maxTradeLimit: '15150.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '1.01', minTradeLimit: '1000.00', maxTradeLimit: '5971.00', orderCompleteRate: '100', tradeMonthTimes: 1 },
  { price: '1.00', minTradeLimit: '150.00', maxTradeLimit: '183864.00', orderCompleteRate: '76', tradeMonthTimes: 19 },
  { price: '1.00', minTradeLimit: '500.00', maxTradeLimit: '20592.00', orderCompleteRate: '97', tradeMonthTimes: 86 },
  { price: '1.00', minTradeLimit: '300.00', maxTradeLimit: '10000.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
  { price: '1.00', minTradeLimit: '400.00', maxTradeLimit: '2000.00', orderCompleteRate: '50', tradeMonthTimes: 4 },
  { price: '1.00', minTradeLimit: '1.00', maxTradeLimit: '8000.00', orderCompleteRate: '40', tradeMonthTimes: 6 },
  { price: '1.00', minTradeLimit: '50.00', maxTradeLimit: '1000.00', orderCompleteRate: '100', tradeMonthTimes: 3 },
];

const USD_PAGE_3 = [
  { price: '0.99', minTradeLimit: '400.00', maxTradeLimit: '4000.00', orderCompleteRate: '95', tradeMonthTimes: 79 },
  { price: '0.99', minTradeLimit: '200.00', maxTradeLimit: '20000.00', orderCompleteRate: '86', tradeMonthTimes: 320 },
  { price: '0.99', minTradeLimit: '300.00', maxTradeLimit: '50000.00', orderCompleteRate: '0', tradeMonthTimes: 0 },
];

/** Первые шесть строк евро — сплошь приманки, ни одной с историей. */
const EUR_DECOYS = EUR_PAGE_1.slice(0, 6);

/** Номера валют у HTX — из её же справочника. */
const CNY = '172';
const EUR = '14';
const USD = '2';

const USDT_CNY = { fromCode: 'USDT', toCode: 'CNY' };
const USDT_EUR = { fromCode: 'USDT', toCode: 'EUR' };
const USDT_USD = { fromCode: 'USDT', toCode: 'USD' };

/**
 * Раздел, отвечающий каждому стакану своими страницами. Валюта
 * определяется по параметру запроса — так и различаются три стакана у
 * настоящего раздела. Незнакомая валюта отвечает пустым списком, как и
 * он сам.
 */
function givenBoards(boards: Readonly<Record<string, readonly (readonly unknown[])[]>>) {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    const address = String(url);
    calls.push(address);
    const params = new URL(address).searchParams;
    const page = Number(params.get('currPage') ?? '1');
    const pages = boards[params.get('currency') ?? ''] ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 200, message: 'Success', data: pages[page - 1] ?? [], success: true }),
    } as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** Раздел с одним ответом на всё — или с одним отказом. */
function givenResponse(body: unknown, ok = true) {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('курс по красному стакану HTX', () => {
  it('называет медиану пяти верхних объявлений', async () => {
    // Первые пять юаня: 6,67 и четыре по 6,64. Медиана — 6,64; среднее
    // дало бы 6,646, то есть верхняя строка одного мерчанта весила бы
    // пятую часть цены.
    const { fetch } = givenBoards({ [CNY]: [CNY_OFFERS] });
    const source = createHtxRateSource({ fetch });

    expect((await source.quote(USDT_CNY))?.rate).toBe('6.64');
  });

  it('берёт сторону, по которой сервис продаёт USDT', async () => {
    // Чтобы выдать клиенту валюту, сервис продаёт USDT, а продающий
    // получает по спросу. У HTX эта сторона названа со стороны
    // мерчанта — покупает он, — и стоит она на полпроцента дешевле
    // встречной. Взятая не та сторона означала бы, что сервис выдаёт
    // валюты больше, чем купил.
    const { fetch, calls } = givenBoards({ [CNY]: [CNY_OFFERS] });
    const source = createHtxRateSource({ fetch });

    await source.quote(USDT_CNY);

    expect(calls[0]).toContain('tradeType=buy');
  });

  it('не считает объявления мерчантов без истории', async () => {
    // Верх стакана евро — 1,02 € за USDT от мерчантов без единой сделки
    // за месяц. Посчитанные, они дали бы клиенту евро по цене, за
    // которую никто не купит. В счёт идут пять с историей: 0,87 с
    // первой страницы и четыре со второй — 0,86, 0,86, 0,86, 0,85.
    const { fetch, calls } = givenBoards({ [EUR]: [EUR_PAGE_1, EUR_PAGE_2] });
    const source = createHtxRateSource({ fetch });

    expect((await source.quote(USDT_EUR))?.rate).toBe('0.86');
    expect(calls).toHaveLength(2);
  });

  it('не даёт одной приманке с историей утащить цену', async () => {
    // На долларе приманка прошла фильтр истории: 1,20 $ за USDT от
    // мерчанта с двенадцатью сделками. Пятёрка вышла 1,20 / 1,03 / 1,00
    // / 0,99 / 0,99 — среднее обещало бы 1,04 за монету, которая стоит
    // доллар. Медиана называет доллар.
    const { fetch, calls } = givenBoards({ [USD]: [USD_PAGE_1, USD_PAGE_2, USD_PAGE_3] });
    const source = createHtxRateSource({ fetch });

    expect((await source.quote(USDT_USD))?.rate).toBe('1');
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain('currPage=3');
  });

  it('пропускает лоты, которых фильтр стакана не касается', async () => {
    // Так выглядит ответ, если раздел проигнорировал `amount`: верх
    // занят лотами от 30 000 юаней по своей цене. Приняв их, сервис
    // считал бы юань по 6,68 вместо 6,64 — полпроцента из своего
    // кармана на каждой заявке. История у этих мерчантов настоящая —
    // отсеивает их лот, а не история.
    const { fetch } = givenBoards({ [CNY]: [CNY_LARGE_LOTS, CNY_OFFERS] });
    const source = createHtxRateSource({ fetch });

    expect((await source.quote(USDT_CNY))?.rate).toBe('6.64');
  });

  it('пропускает лот, на котором тысячи юаней не наберётся', async () => {
    // Вторая граница того же правила: по лоту до пятисот юаней сделку
    // на тысячу не совершить. Пять строк, у первой верхняя граница
    // урезана до пятисот — единственное сочинённое здесь поле. Без
    // неё подходящих четыре, и источник молчит; посчитай он её,
    // назвал бы 6,64.
    const [first, ...rest] = CNY_OFFERS.slice(0, 5);
    const { fetch } = givenBoards({ [CNY]: [[{ ...first, maxTradeLimit: '500.00' }, ...rest], []] });
    const source = createHtxRateSource({ fetch });

    expect(await source.quote(USDT_CNY)).toBeNull();
  });

  it('не листает дальше, когда пятёрка набралась', async () => {
    // Лишний запрос в недоговорный адрес не нужен: на первой странице
    // юаня подходящих все десять.
    const { fetch, calls } = givenBoards({ [CNY]: [CNY_OFFERS, CNY_OFFERS] });
    const source = createHtxRateSource({ fetch });

    await source.quote(USDT_CNY);

    expect(calls).toHaveLength(1);
  });

  it('листает не дальше пятой страницы', async () => {
    // Стакан из одних приманок: пятёрка не соберётся никогда, а стучать
    // в недоговорный адрес до бесконечности нельзя.
    const { fetch, calls } = givenBoards({ [EUR]: Array.from({ length: 8 }, () => EUR_DECOYS) });
    const source = createHtxRateSource({ fetch });

    expect(await source.quote(USDT_EUR)).toBeNull();
    expect(calls).toHaveLength(5);
  });

  it('молчит, когда подходящих объявлений меньше пяти', async () => {
    // На первой странице евро с историей двое, дальше стакан пуст.
    // Медиана по двум случайна: честнее отдать пару следующему в
    // цепочке — клиент увидит курс ЕЦБ, а не выдумку.
    const { fetch } = givenBoards({ [EUR]: [EUR_PAGE_1, []] });
    const source = createHtxRateSource({ fetch });

    expect(await source.quote(USDT_EUR)).toBeNull();
  });

  it('считает пустой список отказом, а не отсутствием цены', async () => {
    // Так раздел отвечает на запрос, который ему не понравился: код 200
    // и пустой `data`. Принятый за удачный ответ, он застыл бы в кэше на
    // весь срок его жизни.
    const { fetch } = givenResponse({ code: 200, message: 'Success', data: [], success: true });
    const source = createHtxRateSource({ fetch });

    expect(await source.quote(USDT_CNY)).toBeNull();
  });

  it('молчит, когда раздел отвечает отказом', async () => {
    const { fetch } = givenResponse({ code: 200, data: CNY_OFFERS }, false);
    const source = createHtxRateSource({ fetch });

    expect(await source.quote(USDT_CNY)).toBeNull();
  });

  it('переживает испорченную цену в чужом ответе', async () => {
    // Строка, которая не число, роняла бы разбор целиком: `Money` на
    // такой бросает, и весь стакан превратился бы в молчание раздела.
    // Шесть строк, у первой цена испорчена: она пропущена, пятёрка
    // собирается из остальных. Упади разбор — источник молчал бы.
    const [first, ...rest] = CNY_OFFERS.slice(0, 6);
    const { fetch } = givenBoards({ [CNY]: [[{ ...first, price: 'n/a' }, ...rest], []] });
    const source = createHtxRateSource({ fetch });

    expect((await source.quote(USDT_CNY))?.rate).toBe('6.64');
  });

  it('пропускает объявление без границ лота', async () => {
    // Без них нельзя сказать, можно ли по нему совершить сделку на
    // тысячу, — а правило владельца именно про это.
    const [first, ...rest] = CNY_OFFERS.slice(0, 6);
    const stripped = { price: first?.price, orderCompleteRate: '99', tradeMonthTimes: 152 };
    const { fetch } = givenBoards({ [CNY]: [[stripped, ...rest], []] });
    const source = createHtxRateSource({ fetch });

    expect((await source.quote(USDT_CNY))?.rate).toBe('6.64');
  });

  it('не называет обратной пары', async () => {
    // Спрошена одна сторона стакана — та, по которой сервис продаёт
    // USDT. Приём валюты сервис не торгует, и выводить цену встречной
    // стороны из этой значило бы назвать курс, которого никто не давал.
    const { fetch, calls } = givenBoards({ [CNY]: [CNY_OFFERS] });
    const source = createHtxRateSource({ fetch });

    expect(await source.quote({ fromCode: 'CNY', toCode: 'USDT' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('о чужих парах молчит, не сходив в сеть', async () => {
    // Стаканы спрошены про юань, евро и доллар. Бат и рубль знают
    // соседи по цепочке, а запрос ради заведомого «нет» — это лишний
    // стук в недоговорный адрес.
    const { fetch, calls } = givenBoards({ [CNY]: [CNY_OFFERS] });
    const source = createHtxRateSource({ fetch });

    expect(await source.quote({ fromCode: 'USDT', toCode: 'THB' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('спрашивает каждый стакан его номером и с порогом от тысячи', async () => {
    // Монета и валюты — внутренние номера HTX, взятые из её же
    // справочников: USDT это монета 2, юань — валюта 172, евро — 14,
    // доллар — 2.
    const { fetch, calls } = givenBoards({
      [CNY]: [CNY_OFFERS],
      [EUR]: [EUR_PAGE_1, EUR_PAGE_2],
      [USD]: [USD_PAGE_1, USD_PAGE_2, USD_PAGE_3],
    });
    const source = createHtxRateSource({ fetch });

    await source.quote(USDT_CNY);
    await source.quote(USDT_EUR);
    await source.quote(USDT_USD);

    const first = calls.filter((url) => url.includes('currPage=1'));
    expect(first).toHaveLength(3);
    for (const url of first) {
      expect(url).toContain('https://www.htx.com/-/x/otc/v1/data/trade-market?');
      expect(url).toContain('coinId=2');
      expect(url).toContain('amount=1000');
    }
    expect(first[0]).toContain('currency=172');
    expect(first[1]).toContain('currency=14');
    expect(first[2]).toContain('currency=2&');
  });

  it('держит стаканы порознь: молчание одного не ронет другой', async () => {
    // У евро и юаня свои запросы и свои снимки. Стакан евро, отдавший
    // одни приманки, молчит, а юань в ту же минуту называется.
    const { fetch } = givenBoards({ [CNY]: [CNY_OFFERS], [EUR]: [EUR_DECOYS] });
    const source = createHtxRateSource({ fetch });

    expect(await source.quote(USDT_EUR)).toBeNull();
    expect((await source.quote(USDT_CNY))?.rate).toBe('6.64');
  });
});
