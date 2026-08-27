import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money, type Amount } from '@nemo/types';
import { createSnapshotCache, type SnapshotCache } from './snapshots.js';

/**
 * Котировки HTX P2P — источник курса юаня, евро и доллара.
 *
 * Названа владельцем прямо: «курс USD → CNY берём с HTX», а 27 августа
 * 2026 — и про евро с долларом: «с рубля получаем USDT по Rapira, дальше
 * с HTX вытягиваем конвертацию $ → EUR, это наш себес, и поверх него
 * ставки». Себестоимость валюты — то, по чему сервис её на самом деле
 * покупает, и покупает он на этом разделе: мерчанты меняют USDT на
 * фиат по своим ценам, тот самый «красный стакан» из ТЗ — это он. На
 * самой бирже юаня нет и быть не может — китайским площадкам запрещено
 * торговать в юанях с 2021 года, — а евро и доллар она котирует, но не
 * по той цене, по которой сервис их получает.
 *
 * Отсюда и цена этого источника: адрес раздела не описан договором, и
 * ломается он без предупреждения. Это осознанно — курс, посчитанный по
 * официальному курсу ЕЦБ, расходится с ценой, по которой валюту
 * покупают на самом деле, и разницу сервис нёс бы на себе. Молчание
 * провайдера при этом рабочее состояние: ЕЦБ стоит в цепочке следом и
 * подхватит пару, а не уронит экран.
 *
 * Сторона стакана выбрана по тому, куда идут деньги сервиса. Чтобы
 * выдать клиенту валюту, сервис продаёт USDT, — значит смотрит на
 * объявления, в которых USDT покупают. У HTX это `tradeType=buy`, и
 * названо оно со стороны мерчанта, а не пользователя: проверено 14
 * августа 2026 по ценам и порядку. На `buy` цены идут по убыванию
 * (6,66 → 6,64) — лучшее сверху для того, кто USDT продаёт; на `sell`
 * по возрастанию (6,69 → 6,76) — лучшее сверху для того, кто покупает.
 * Разница между сторонами около полупроцента, и взятая не та сторона
 * означала бы, что сервис выдаёт валюты больше, чем купил.
 *
 * Встречную сторону сервис не торгует вовсе, и обратной пары этот
 * источник не называет: у стакана спрошена одна половина, и выводить из
 * неё вторую значило бы назвать цену, которой на рынке никто не давал.
 *
 * Порядок объявлений берётся тот, в котором их отдаёт сам раздел, —
 * по цене, лучшей сверху. Своей сортировки здесь нет намеренно: «первые
 * пять» из ТЗ — это первые пять строк, которые владелец видит на экране
 * HTX, и переставлять их значило бы считать не то, о чём договорились.
 *
 * Но не всякая строка на экране — цена. Замерено 27 августа 2026: верх
 * стакана евро занимали 1,02 € за USDT при 0,86 на бирже, верх
 * долларового — 1,20 $ при единице, и все эти объявления — от
 * мерчантов без единой сделки за месяц и с нулевым процентом
 * исполнения. Это приманки: сделка по ним не состоится, а цена в
 * среднем по пятёрке осталась бы. Стакан юаня чист — там первые
 * страницы держат мерчанты с тысячами сделок, — и правило одно на все
 * три: в счёт идут объявления мерчантов с историей, а из пятёрки
 * берётся медиана, которую одна приманка утащить не может.
 */

const RATES_URL = 'https://www.htx.com/-/x/otc/v1/data/trade-market';

/**
 * Монета, которую сервис продаёт, — внутренний номер HTX из её же
 * справочника `config-list?type=coin`: USDT это монета 2.
 */
const COIN_USDT = '2';

/** Стакан одной валюты выдачи: как его спросить и что в нём считается. */
interface Board {
  /**
   * Номер валюты у HTX — из справочника `config-list?type=currency`.
   * Юань там числится как CNH, офшорный, и это правильная сторона:
   * расчёты в USDT идут по нему, а не по курсу материкового Китая.
   */
  readonly currency: string;
  /**
   * Фильтр стакана из ТЗ: «учитывать только заявки от 1 000 CNY и
   * выше». Порог в валюте стакана. Раздел понимает его сам — параметр
   * `amount` оставляет объявления, по которым сделку на эту сумму можно
   * совершить: границы лота накрывают её с обеих сторон. Проверяется он
   * и при разборе, теми же двумя границами: параметр чужой и
   * недоговорный, а проигнорированный молча он подменил бы цену.
   * Замерено 14 августа 2026: без фильтра верх юаневого стакана
   * занимают лоты от 33 000 CNY по 6,68, с фильтром — по 6,65.
   * Полпроцента разницы сервис отдал бы клиенту из своего кармана.
   */
  readonly minOrder: string;
}

/**
 * Стаканы, которые сервис читает: валюта выдачи → как её спрашивать.
 *
 * Номера сняты 14 августа 2026 (юань) и 27 августа 2026 (евро,
 * доллар). Порог у евро и доллара тот же, что у юаня, — тысяча в
 * валюте стакана: владелец назвал его один раз, для юаня, и второго
 * правила не давал. Валюта, которой здесь нет, у стакана не
 * спрашивается вовсе — её знают соседи по цепочке.
 */
const BOARDS: Readonly<Record<string, Board>> = {
  CNY: { currency: '172', minOrder: '1000' },
  EUR: { currency: '14', minOrder: '1000' },
  USD: { currency: '2', minOrder: '1000' },
};

/**
 * Сколько страниц пролистать, набирая пятёрку.
 *
 * Юаню хватает первой: раздел отдаёт по десять объявлений, и все
 * десять проходят его же фильтр. Евро и доллару нужно больше: верх их
 * стаканов занят приманками без истории, и пятёрка настоящих собирается
 * со второй-третьей страницы — замерено 27 августа 2026. Пять страниц —
 * запас на день, когда приманок станет больше; без него источник
 * замолчал бы, и валюта молча вернулась бы к опорному курсу банка.
 * Размер страницы не задать: `pageSize` в запросе раздел игнорирует,
 * всегда отвечая десяткой.
 */
const MAX_PAGES = 5;

/**
 * Сколько объявлений идёт в счёт. Пять, как названо в ТЗ: одно верхнее
 * — это цена одного мерчанта, который может увести её на процент за
 * минуту, а пятёрка держит стакан целиком.
 */
const TOP_OFFERS = 5;

/**
 * История мерчанта, ниже которой объявление не считается ценой.
 *
 * Оба числа раздел отдаёт сам: процент исполненных заявок и число
 * сделок за последний месяц. У приманок обе — нули; у мерчантов, с
 * которыми сделка состоится, исполнение за девяносто, а сделок за месяц
 * десятки и сотни. Пороги поставлены между этими двумя картинами с
 * запасом в сторону мерчанта: восемьдесят процентов и десять сделок.
 * Замерено 27 августа 2026 по стаканам юаня, евро и доллара: юань они
 * не трогают вовсе, евро и доллар очищают до цен, сходящихся с биржей
 * в полпроцента.
 */
const MIN_COMPLETION_PERCENT = 80;
const MIN_MONTH_DEALS = 10;

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

/**
 * Объявление мерчанта. Цена и границы лота приходят строками, история —
 * процент строкой и число сделок числом; разбираются все как есть.
 */
interface HtxOffer {
  readonly price?: unknown;
  readonly minTradeLimit?: unknown;
  readonly maxTradeLimit?: unknown;
  readonly orderCompleteRate?: unknown;
  readonly tradeMonthTimes?: unknown;
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
 * Счётчик из ответа — процент или число сделок. Здесь достаточно
 * `Number`: это не деньги, и сравнивается он с порогом, а не считается.
 */
function toCount(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

/**
 * Годится ли объявление в счёт: по нему можно совершить сделку на
 * порог стакана, и мерчант за ним — с историей.
 */
function qualifies(offer: HtxOffer, threshold: Amount): boolean {
  const lower = toAmount(offer.minTradeLimit);
  const upper = toAmount(offer.maxTradeLimit);
  if (lower === null || upper === null) return false;
  /*
   * Порог лежит между границами лота. Обе границы значимы, и каждая
   * ловит своё. Верхняя отсекает мелочь — лот на пятьсот юаней; нижняя
   * отсекает крупняк, которым занят стакан без фильтра: лоты от 33 000
   * идут по своей, другой цене, и сервис по ним не работает.
   */
  if (Money.compare(lower, threshold) > 0 || Money.compare(upper, threshold) < 0) return false;

  /*
   * История мерчанта. Объявление без неё — не «неизвестно», а «не в
   * счёт»: приманки приходят именно без истории, и сомнение здесь
   * стоит сервису обещанной клиенту цены, за которую никто не купит.
   */
  const completion = toCount(offer.orderCompleteRate);
  const monthDeals = toCount(offer.tradeMonthTimes);
  if (completion === null || monthDeals === null) return false;
  return completion >= MIN_COMPLETION_PERCENT && monthDeals >= MIN_MONTH_DEALS;
}

/**
 * Цены подходящих объявлений со страницы — к тем, что уже набраны.
 *
 * Набирается ровно пятёрка и не больше: дальше страница не читается.
 */
function topPrices(
  offers: readonly HtxOffer[],
  threshold: Amount,
  collected: readonly Amount[],
): Amount[] {
  const prices = [...collected];

  for (const offer of offers) {
    if (prices.length === TOP_OFFERS) break;
    const price = toAmount(offer.price);
    if (price === null || !qualifies(offer, threshold)) continue;
    prices.push(price);
  }

  return prices;
}

/**
 * Медиана набранной пятёрки.
 *
 * Не среднее: у среднего одна приманка, прошедшая фильтр, весит пятую
 * часть цены. Замерено 27 августа 2026 на долларе: пятёрка с историей
 * вышла 1,20 / 1,03 / 1,00 / 0,99 / 0,99 — среднее обещало бы клиенту
 * 1,04 доллара за монету, которая стоит доллар, медиана называет
 * доллар. На чистом стакане юаня разницы между ними нет.
 */
function median(prices: readonly Amount[]): Amount {
  const sorted = [...prices].sort((left, right) => Money.compare(left, right));
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as Amount;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1] as Amount;
  return Money.divide(Money.add(lower, upper), Money.toAmount('2'));
}

export function createHtxRateSource(options: HtxOptions = {}): RateSource {
  const request = options.fetch ?? globalThis.fetch;

  /** Одна страница стакана. Отказ раздела — исключение, а не пустота. */
  async function fetchPage(board: Board, page: number): Promise<readonly HtxOffer[]> {
    const query = new URLSearchParams({
      coinId: COIN_USDT,
      currency: board.currency,
      // Сторона стакана: объявления, в которых USDT покупают за валюту.
      // Названа она со стороны мерчанта — он тут покупающий.
      tradeType: 'buy',
      currPage: String(page),
      payMethod: '0',
      country: '',
      blockType: 'general',
      online: '1',
      range: '0',
      amount: board.minOrder,
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
     * жизни, и валюта пропала бы на минуту при живом стакане.
     */
    if (!Array.isArray(data)) {
      throw new Error('HTX ответила не списком объявлений');
    }
    return data as readonly HtxOffer[];
  }

  async function fetchRate(board: Board): Promise<Amount> {
    const threshold = Money.toAmount(board.minOrder);
    let prices: Amount[] = [];

    for (let page = 1; page <= MAX_PAGES && prices.length < TOP_OFFERS; page += 1) {
      const offers = await fetchPage(board, page);
      // Пустая страница означает, что стакан кончился: дальше листать
      // некуда, и добирать пятёрку неоткуда.
      if (offers.length === 0) break;
      prices = topPrices(offers, threshold, prices);
    }

    /*
     * Пятёрка не набралась — источник молчит. Это не «посчитаем по
     * трём»: стакан из трёх подходящих лотов означает, что раздел отдал
     * не то, и цена по нему случайна. Честнее отдать пару следующему в
     * цепочке, чем назвать цену, за которую сервис отвечает.
     */
    if (prices.length < TOP_OFFERS) {
      throw new Error('HTX отдала меньше пяти подходящих объявлений');
    }
    return median(prices);
  }

  /*
   * У каждого стакана свой кэш: юань, евро и доллар — три разных
   * запроса, и молчание одного не должно ронять остальные. Имя
   * провайдера в журнале — со стаканом, иначе по строке «HTX не
   * ответила» не понять, какая валюта осталась без курса.
   */
  const caches = new Map<string, SnapshotCache<Amount>>(
    Object.entries(BOARDS).map(([code, board]) => [
      code,
      createSnapshotCache({
        load: () => fetchRate(board),
        ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
        maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
        provider: `HTX ${code}`,
        ...(options.now ? { now: options.now } : {}),
      }),
    ]),
  );

  if (options.warmUp) {
    for (const cache of caches.values()) cache.warmUp();
  }

  return {
    async quote(pair: RatePair, at?: Date): Promise<RateQuote | null> {
      // Спрошенные стаканы — про три пары и одну их сторону. Всё
      // остальное здесь молчит, не сходив в сеть: чужие пары спрашивают
      // у соседей по цепочке.
      if (pair.fromCode.toUpperCase() !== 'USDT') return null;
      const cache = caches.get(pair.toCode.toUpperCase());
      if (!cache) return null;

      const snapshot = await cache.read(at);
      if (!snapshot) return null;

      return { rate: snapshot.value, asOf: new Date(snapshot.at) };
    },
  };
}
