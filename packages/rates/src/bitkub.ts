import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money } from '@nemo/types';
import { createSnapshotCache } from './snapshots.js';

/**
 * Котировки Bitkub — источник курса тайского бата.
 *
 * Взята по прямому указанию владельца в ТЗ на обмен рублей в баты, и
 * выбор осмысленный: Bitkub — крупнейшая тайская биржа, и бат там
 * торгуется, а не публикуется справочно. У Европейского центробанка,
 * которым бат котировался до сих пор, курс опорный и обновляется раз в
 * рабочий день — по нему нельзя купить.
 *
 * Пары названы `BASE_QUOTE`: `USDT_THB` — это цена одного USDT в батах.
 *
 * Сторона стакана выбирается по тому, куда идут деньги сервиса. Чтобы
 * выдать клиенту баты, сервис продаёт USDT, а продающий получает по цене
 * спроса — значит курс `USDT → THB` это `highest_bid`. Обратное
 * направление сервис не торгует вовсе, и цена ему считалась бы от
 * `lowest_ask`: покупающий платит по предложению. Так исполняется пункт
 * 5 ТЗ — «учитывать стоимость и спред получения курса»: спред учтён той
 * ценой, по которой сделка и происходит, а не надбавкой поверх неё.
 */

const RATES_URL = 'https://api.bitkub.com/api/v3/market/ticker';

/**
 * Пара, ради которой источник и заведён.
 *
 * Спрашивается именно она, а не весь список: полный ответ биржи — 96
 * килобайт на сто с лишним пар, а нужная из них одна и весит двести
 * байт. Снимок обновляется сам раз в минуту, круглые сутки, — на полном
 * ответе это сто тридцать мегабайт в день, выброшенных ради одной
 * строки. Списком пары не спросить — на
 * `sym=A,B` биржа отвечает отказом; понадобится вторая пара — это будет
 * второй запрос, и решать это стоит тогда, когда она появится.
 */
const DEFAULT_SYMBOL = 'USDT_THB';

/**
 * Через сколько котировка просит обновления. Минута, как у биржи в
 * `rapira.ts`, и по той же причине: этот же срок задаёт, как часто
 * снимок обновляется сам, без клиента, — а стучать в чужой публичный
 * API раз в десять секунд круглые сутки не за чем. Бат стабилен ровно
 * настолько, чтобы минутная давность ничего не стоила.
 */
const DEFAULT_TTL_MS = 60_000;

/** Сколько ждать биржу, прежде чем считать её молчащей. */
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Насколько старую котировку ещё можно показывать. Час, как у соседней
 * биржи и по той же причине: срок этот про молчание провайдера, а не
 * про паузу между клиентами. По такому курсу подают заявку, а она
 * обязательство.
 */
const DEFAULT_MAX_AGE_MS = 60 * 60_000;

export interface BitkubOptions {
  /** Какую пару спрашивать. Подменяется в тестах. */
  readonly symbol?: string;
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

/** Строка ответа биржи. Числа приходят строками — их и разбираем. */
interface BitkubTicker {
  readonly symbol?: unknown;
  readonly highest_bid?: unknown;
  readonly lowest_ask?: unknown;
}

/** Обе стороны стакана по паре. */
interface Book {
  readonly bid: string;
  readonly ask: string;
}

/**
 * Цена из ответа. Строкой, а не числом: биржа так и отдаёт, и через
 * `double` её гонять незачем — `Money` принимает десятичную запись.
 */
function toPrice(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let price: ReturnType<typeof Money.toAmount>;
  try {
    price = Money.toAmount(String(value));
  } catch {
    /*
     * Не число — значит цены нет, и это не повод ронять разбор целиком.
     * Брошенное отсюда исключение считалось бы молчанием биржи: кэш
     * остался бы пустым, и курс пропал бы у всех из-за одной испорченной
     * строки в чужом ответе.
     */
    return null;
  }
  return Money.isZero(price) || Money.isNegative(price) ? null : price;
}

export function createBitkubRateSource(options: BitkubOptions = {}): RateSource {
  const request = options.fetch ?? globalThis.fetch;

  /**
   * Кэшируется весь список пар, а не одна: биржа отдаёт его одним
   * запросом, и спрашивать по паре значило бы ходить к ней столько раз,
   * сколько направлений на экране.
   */
  async function fetchTickers(): Promise<Map<string, Book>> {
    const symbol = options.symbol ?? DEFAULT_SYMBOL;
    const response = await request(`${RATES_URL}?sym=${encodeURIComponent(symbol)}`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Bitkub ответила ${response.status}`);
    }

    const body: unknown = await response.json();
    /*
     * Отказ биржа отдаёт двумя разными способами: объектом с полем
     * `error` (так отвечает старый путь без `v3`) и просто не массивом.
     * И то и другое здесь — молчание провайдера, а не пустой список
     * пар: пустым списком кэш заполнился бы как удачным ответом и
     * держал бы его до следующего обновления.
     */
    if (!Array.isArray(body)) {
      throw new Error('Bitkub ответила не списком котировок');
    }

    const book = new Map<string, Book>();
    // Пустой список — тоже отказ, а не «пар нет»: биржа так отвечает на
    // незнакомую пару, и принятый за удачный ответ он застыл бы в кэше
    // на весь срок его жизни.
    if (body.length === 0) {
      throw new Error('Bitkub отдала пустой список котировок');
    }
    for (const item of body as readonly BitkubTicker[]) {
      const bid = toPrice(item.highest_bid);
      const ask = toPrice(item.lowest_ask);
      if (typeof item.symbol === 'string' && bid !== null && ask !== null) {
        book.set(item.symbol.toUpperCase(), { bid, ask });
      }
    }
    return book;
  }

  const cache = createSnapshotCache({
    load: fetchTickers,
    ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    provider: 'Bitkub',
    ...(options.now ? { now: options.now } : {}),
  });

  if (options.warmUp) cache.warmUp();

  const symbol = (options.symbol ?? DEFAULT_SYMBOL).toUpperCase();

  return {
    async quote(pair: RatePair, at?: Date): Promise<RateQuote | null> {
      const from = pair.fromCode.toUpperCase();
      const to = pair.toCode.toUpperCase();

      // Спрошенная у биржи пара одна, и известна она до похода в кэш.
      // Чужие пары молчат, не читая его: чтение умеет ждать провайдера,
      // и в цепочке эти ожидания складывались бы у пар, которых биржа
      // не знает вовсе.
      if (`${from}_${to}` !== symbol && `${to}_${from}` !== symbol) return null;

      const snapshot = await cache.read(at);
      if (!snapshot) return null;

      const asOf = new Date(snapshot.at);

      // Прямая пара: сервис отдаёт то, что стоит в основании пары, и
      // получает по цене спроса.
      const direct = snapshot.value.get(`${from}_${to}`);
      if (direct) return { rate: Money.toAmount(direct.bid), asOf };

      // Обратная: сервис покупает основание пары и платит по цене
      // предложения. Курс — обратный к ней.
      const inverse = snapshot.value.get(`${to}_${from}`);
      if (inverse) {
        return { rate: Money.divide(Money.toAmount('1'), Money.toAmount(inverse.ask)), asOf };
      }

      return null;
    },
  };
}
