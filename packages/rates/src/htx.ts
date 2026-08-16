import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money, type Amount } from '@nemo/types';
import { createSnapshotCache } from './snapshots.js';

/**
 * Котировки HTX P2P — источник курса юаня.
 *
 * Названа владельцем прямо: «курс USD → CNY берём с HTX». На самой бирже
 * юаня нет и быть не может — китайским площадкам запрещено торговать в
 * юанях с 2021 года, и среди двух с лишним тысяч её пар нет ни одной
 * юаневой. Живёт юань у HTX в разделе P2P, где мерчанты меняют USDT на
 * юани по своим ценам; тот самый «красный стакан» из ТЗ — это он.
 *
 * Отсюда и цена этого источника: адрес раздела не описан договором, и
 * ломается он без предупреждения. Это осознанно — курс, посчитанный по
 * официальному курсу ЕЦБ, расходится с ценой, по которой юани покупают
 * на самом деле, и разницу сервис нёс бы на себе. Молчание провайдера
 * при этом рабочее состояние: ЕЦБ стоит в цепочке следом и подхватит
 * пару, а не уронит экран.
 *
 * Сторона стакана выбрана по тому, куда идут деньги сервиса. Чтобы
 * выдать клиенту юани, сервис продаёт USDT, — значит смотрит на
 * объявления, в которых USDT покупают. У HTX это `tradeType=buy`, и
 * названо оно со стороны мерчанта, а не пользователя: проверено 14
 * августа 2026 по ценам и порядку. На `buy` цены идут по убыванию
 * (6,66 → 6,64) — лучшее сверху для того, кто USDT продаёт; на `sell`
 * по возрастанию (6,69 → 6,76) — лучшее сверху для того, кто покупает.
 * Разница между сторонами около полупроцента, и взятая не та сторона
 * означала бы, что сервис выдаёт юаней больше, чем купил.
 *
 * Встречную сторону сервис не торгует вовсе, и обратной пары этот
 * источник не называет: у стакана спрошена одна половина, и выводить из
 * неё вторую значило бы назвать цену, которой на рынке никто не давал.
 *
 * Порядок объявлений берётся тот, в котором их отдаёт сам раздел, —
 * по цене, лучшей сверху. Своей сортировки здесь нет намеренно: «первые
 * пять» из ТЗ — это первые пять строк, которые владелец видит на экране
 * HTX, и переставлять их значило бы считать не то, о чём договорились.
 */

const RATES_URL = 'https://www.htx.com/-/x/otc/v1/data/trade-market';

/**
 * Что спрашиваем у раздела. Числа — внутренние идентификаторы HTX,
 * взятые из её же справочников (`config-list?type=coin` и `=currency`)
 * 14 августа 2026: USDT это монета 2, юань — валюта 172. Она числится
 * там как CNH, офшорный юань, и это правильная сторона: расчёты в USDT
 * идут по нему, а не по курсу материкового Китая.
 */
const COIN_USDT = '2';
const CURRENCY_CNY = '172';

/**
 * Фильтр стакана из ТЗ: «учитывать только заявки от 1 000 CNY и выше».
 *
 * Раздел понимает его сам — параметр `amount` оставляет объявления, по
 * которым сделку на эту сумму можно совершить: границы лота накрывают
 * тысячу с обеих сторон. Проверяется он и при разборе, теми же двумя
 * границами: параметр чужой и недоговорный, а проигнорированный молча
 * он подменил бы цену. Замерено 14 августа 2026: без фильтра верх
 * стакана занимают лоты от 33 000 CNY по 6,68, с фильтром — по 6,65.
 * Полпроцента разницы сервис отдал бы клиенту из своего кармана.
 */
const MIN_ORDER_CNY = '1000';

/**
 * Сколько страниц пролистать, набирая пятёрку.
 *
 * Обычно хватает первой: раздел отдаёт по десять объявлений, и все
 * десять проходят его же фильтр. Вторая нужна на случай, когда
 * подходящих на первой меньше пяти, — иначе источник замолчал бы, и
 * юань молча вернулся бы к опорному курсу банка. Размер страницы не
 * задать: `pageSize` в запросе раздел игнорирует, всегда отвечая
 * десяткой.
 */
const MAX_PAGES = 2;

/**
 * Сколько объявлений усредняется. Пять, как названо в ТЗ: одно верхнее
 * — это цена одного мерчанта, который может увести её на процент за
 * минуту, а среднее по пяти держит стакан целиком.
 */
const TOP_OFFERS = 5;

/**
 * Через сколько котировка просит обновления. Минута — столько же, что и
 * у бирж, но пришли они к этому с разных сторон: там минуту поставили,
 * чтобы не стучать круглые сутки почём зря, а здесь она стояла с самого
 * начала. P2P-цена меняется шагом в копейку и заметно медленнее рынка,
 * а адрес недоговорный — стучать в него чаще нужного значит
 * напрашиваться на отказ.
 */
const DEFAULT_TTL_MS = 60_000;

/** Сколько ждать раздел, прежде чем считать его молчащим. */
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Насколько старую котировку ещё можно показывать. Час, как у бирж и по
 * той же причине: срок этот отвечает на молчание раздела, а не на паузу
 * между клиентами. По такому курсу подают заявку, а она обязательство.
 *
 * Раздел этот вдобавок недоговорный и ломается без предупреждения — тем
 * важнее, чтобы известная цена не пропадала раньше, чем он успеет
 * починиться.
 */
const DEFAULT_MAX_AGE_MS = 60 * 60_000;

export interface HtxOptions {
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly maxAgeMs?: number;
  /** Сходить за котировками при создании источника, не дожидаясь клиента. */
  readonly warmUp?: boolean;
  /** Подменяется в тестах: сети в них нет. */
  readonly fetch?: typeof globalThis.fetch;
  /** Подменяется в тестах, чтобы проверить устаревание кэша. */
  readonly now?: () => number;
}

/** Объявление мерчанта. Числа приходят строками — их и разбираем. */
interface HtxOffer {
  readonly price?: unknown;
  readonly minTradeLimit?: unknown;
  readonly maxTradeLimit?: unknown;
}

/**
 * Число из ответа. Строкой, а не через `double`: `Money` принимает
 * десятичную запись, и гонять цену через двоичную дробь незачем.
 */
function toAmount(value: unknown): Amount | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let amount: Amount;
  try {
    amount = Money.toAmount(String(value));
  } catch {
    /*
     * Не число — значит объявления нет. Брошенное отсюда исключение
     * считалось бы молчанием раздела: курс пропал бы у всех из-за одной
     * испорченной строки в чужом ответе.
     */
    return null;
  }
  return Money.isZero(amount) || Money.isNegative(amount) ? null : amount;
}

/**
 * Цены подходящих объявлений со страницы — к тем, что уже набраны.
 *
 * Набирается ровно пятёрка и не больше: дальше страница не читается.
 */
function topPrices(offers: readonly HtxOffer[], collected: readonly Amount[]): Amount[] {
  const threshold = Money.toAmount(MIN_ORDER_CNY);
  const prices = [...collected];

  for (const offer of offers) {
    if (prices.length === TOP_OFFERS) break;

    const price = toAmount(offer.price);
    const lower = toAmount(offer.minTradeLimit);
    const upper = toAmount(offer.maxTradeLimit);
    if (price === null || lower === null || upper === null) continue;
    /*
     * Годится объявление, по которому сделку на тысячу юаней можно
     * совершить: тысяча лежит между границами лота. Обе границы
     * значимы, и каждая ловит своё. Верхняя отсекает мелочь — лот на
     * пятьсот юаней; нижняя отсекает крупняк, которым занят стакан без
     * фильтра: лоты от 33 000 идут по своей, другой цене, и сервис по
     * ним не работает.
     */
    if (Money.compare(lower, threshold) > 0 || Money.compare(upper, threshold) < 0) continue;
    prices.push(price);
  }

  return prices;
}

/** Средняя по набранной пятёрке. */
function average(prices: readonly Amount[]): Amount {
  const sum = prices.reduce((total, price) => Money.add(total, price), Money.ZERO);
  return Money.divide(sum, Money.toAmount(String(prices.length)));
}

export function createHtxRateSource(options: HtxOptions = {}): RateSource {
  const request = options.fetch ?? globalThis.fetch;

  /** Одна страница стакана. Отказ раздела — исключение, а не пустота. */
  async function fetchPage(page: number): Promise<readonly HtxOffer[]> {
    const query = new URLSearchParams({
      coinId: COIN_USDT,
      currency: CURRENCY_CNY,
      // Сторона стакана: объявления, в которых USDT покупают за юани.
      // Названа она со стороны мерчанта — он тут покупающий.
      tradeType: 'buy',
      currPage: String(page),
      payMethod: '0',
      country: '',
      blockType: 'general',
      online: '1',
      range: '0',
      amount: MIN_ORDER_CNY,
      onlyTradable: 'false',
      isFollowed: 'false',
    });

    const response = await request(`${RATES_URL}?${query.toString()}`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTX ответила ${response.status}`);
    }

    const body: unknown = await response.json();
    const data =
      typeof body === 'object' && body !== null ? (body as { data?: unknown }).data : undefined;
    /*
     * Отказ раздел отдаёт кодом 200 и пустым списком — так он отвечает
     * и на незнакомую валюту, и на запрос, который ему не понравился.
     * Принятый за удачный ответ, он застыл бы в кэше на весь срок его
     * жизни, и юань пропал бы на минуту при живом стакане.
     */
    if (!Array.isArray(data)) {
      throw new Error('HTX ответила не списком объявлений');
    }
    return data as readonly HtxOffer[];
  }

  async function fetchRate(): Promise<Amount> {
    let prices: Amount[] = [];

    for (let page = 1; page <= MAX_PAGES && prices.length < TOP_OFFERS; page += 1) {
      const offers = await fetchPage(page);
      // Пустая страница означает, что стакан кончился: дальше листать
      // некуда, и добирать пятёрку неоткуда.
      if (offers.length === 0) break;
      prices = topPrices(offers, prices);
    }

    /*
     * Пятёрка не набралась — источник молчит. Это не «посчитаем по
     * трём»: стакан из трёх подходящих лотов означает, что раздел отдал
     * не то, и средняя по нему случайна. Честнее отдать пару следующему
     * в цепочке, чем назвать цену, за которую сервис отвечает.
     */
    if (prices.length < TOP_OFFERS) {
      throw new Error('HTX отдала меньше пяти подходящих объявлений');
    }
    return average(prices);
  }

  const cache = createSnapshotCache({
    load: fetchRate,
    ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    provider: 'HTX',
    ...(options.now ? { now: options.now } : {}),
  });

  if (options.warmUp) cache.warmUp();

  return {
    async quote(pair: RatePair, at?: Date): Promise<RateQuote | null> {
      // Спрошенный стакан — про одну пару и одну её сторону. Всё
      // остальное здесь молчит, не сходив в сеть: чужие пары спрашивают
      // у соседей по цепочке.
      if (pair.fromCode.toUpperCase() !== 'USDT' || pair.toCode.toUpperCase() !== 'CNY') {
        return null;
      }

      const snapshot = await cache.read(at);
      if (!snapshot) return null;

      return { rate: snapshot.value, asOf: new Date(snapshot.at) };
    },
  };
}
