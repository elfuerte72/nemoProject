import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money } from '@nemo/types';
import { createSnapshotCache } from './snapshots.js';

/**
 * Котировки Kraken — источник курса доллара и евро.
 *
 * До сих пор обе валюты приходили от Европейского центробанка, и доллар
 * там даже не котировался: USDT приравнен к доллару таблицей в
 * `fiat.ts`, то есть курс был ровно единицей. Замерено 14 августа
 * 2026: рынок даёт за монету 0,9989 доллара и 0,8649 евро, банк —
 * единицу и 0,867 курсом за прошлый рабочий день. Ноль целых одна
 * десятая процента по доллару и почти четверть процента по евро сервис
 * выдавал бы сверх купленного, и это при наценке в два.
 *
 * Причина та же, по которой бат берётся у тайской биржи, а юань — из
 * красного стакана: у банка курс опорный и суточный, по нему не
 * купить. В выходные он и вовсе пятничный.
 *
 * Пары названы так, как их зовёт сама биржа: доллар у неё `USDTZUSD` —
 * `Z` перед фиатной валютой достался Kraken от первых лет, — а евро
 * `USDTEUR`. Склейка кодов ушла бы в никуда, поэтому имена заданы
 * таблицей, и она же задаёт охват источника: чужие пары он молчит, не
 * сходив в сеть.
 *
 * Сторона стакана выбрана по тому, куда идут деньги сервиса. Чтобы
 * выдать клиенту доллары или евро, сервис продаёт USDT, а продающий
 * получает по цене спроса — значит курс `USDT → USD` это `b`.
 * Встречное направление сервис не торгует, но цена ему считается
 * честно, от `a`: покупающий платит по предложению. Так спред учтён той
 * ценой, по которой сделка и происходит, а не надбавкой поверх неё.
 */

const RATES_URL = 'https://api.kraken.com/0/public/Ticker';

/**
 * Пары, ради которых источник заведён, — и их имена у биржи.
 *
 * Спрашиваются обе одним запросом: биржа принимает список через
 * запятую, и второй поход в сеть заводить незачем. Ключ — пара так, как
 * её знает сервис.
 */
const SYMBOLS: Record<string, string> = {
  'USDT/USD': 'USDTZUSD',
  'USDT/EUR': 'USDTEUR',
};

/**
 * Через сколько котировка просит обновления. Десять секунд, как у
 * соседних бирж, и по той же причине: обновление никого не задерживает
 * — устаревшее отдаётся сразу, за свежим идут в фоне.
 */
const DEFAULT_TTL_MS = 10_000;

/** Сколько ждать биржу, прежде чем считать её молчащей. */
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Насколько старую котировку ещё можно показывать. Пять минут, как у
 * соседних бирж: по такому курсу подают заявку, а она обязательство.
 */
const DEFAULT_MAX_AGE_MS = 5 * 60_000;

/** Снимки ради отметок времени в поданных заявках — на те же пять минут. */
const SNAPSHOTS = 30;

export interface KrakenOptions {
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

/** Ответ биржи: отказы списком, котировки — объектом по имени пары. */
interface KrakenResponse {
  readonly error?: unknown;
  readonly result?: unknown;
}

/** Строка котировки. Стороны стакана — массивы `[цена, лот, объём]`. */
interface KrakenTicker {
  readonly a?: unknown;
  readonly b?: unknown;
}

/** Обе стороны стакана по паре. */
interface Book {
  readonly bid: string;
  readonly ask: string;
}

/**
 * Цена из стороны стакана. Строкой, а не числом: биржа так и отдаёт, и
 * через `double` её гонять незачем — `Money` принимает десятичную
 * запись.
 */
function toPrice(side: unknown): string | null {
  if (!Array.isArray(side)) return null;
  const value: unknown = side[0];
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  let price: ReturnType<typeof Money.toAmount>;
  try {
    price = Money.toAmount(String(value));
  } catch {
    /*
     * Не число — значит цены нет, и это не повод ронять разбор целиком.
     * Брошенное отсюда исключение считалось бы молчанием биржи: кэш
     * остался бы пустым, и курс пропал бы у второй пары из-за одной
     * испорченной строки в чужом ответе.
     */
    return null;
  }
  return Money.isZero(price) || Money.isNegative(price) ? null : price;
}

/** Пара так, как её знает таблица имён. */
function symbolOf(pair: RatePair): string | undefined {
  return SYMBOLS[`${pair.fromCode.toUpperCase()}/${pair.toCode.toUpperCase()}`];
}

export function createKrakenRateSource(options: KrakenOptions = {}): RateSource {
  const request = options.fetch ?? globalThis.fetch;

  async function fetchTickers(): Promise<Map<string, Book>> {
    const query = new URLSearchParams({ pair: Object.values(SYMBOLS).join(',') });
    const response = await request(`${RATES_URL}?${query.toString()}`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Kraken ответила ${response.status}`);
    }

    const body = (await response.json()) as KrakenResponse;
    /*
     * Отказ биржа отдаёт кодом 200: непустой `error` и никакого
     * `result`. Так она отвечает и на незнакомую пару, и на слишком
     * частый запрос. Принятый за удачный ответ, он застыл бы в кэше на
     * весь срок его жизни, и курс пропал бы при живой бирже.
     *
     * Считается при этом только `E` — первая буква у Kraken говорит о
     * тяжести, и `W` это предупреждение, приходящее вместе с рабочим
     * ответом. Выброшенный из-за него ответ увёл бы обе пары к банку,
     * где доллар стоит ровно единицу, — то есть вернул бы ту самую
     * цену, ради ухода от которой источник и заведён.
     */
    const refusals = Array.isArray(body.error)
      ? body.error.filter((one) => typeof one === 'string' && one.startsWith('E'))
      : [];
    if (refusals.length > 0) {
      throw new Error(`Kraken отказала: ${refusals.join('; ')}`);
    }
    const result = body.result;
    if (typeof result !== 'object' || result === null) {
      throw new Error('Kraken ответила не списком котировок');
    }

    const book = new Map<string, Book>();
    for (const [symbol, ticker] of Object.entries(result as Record<string, KrakenTicker>)) {
      const bid = toPrice(ticker?.b);
      const ask = toPrice(ticker?.a);
      if (bid !== null && ask !== null) {
        book.set(symbol.toUpperCase(), { bid, ask });
      }
    }
    /*
     * Ни одной цены — тоже отказ, а не «пар нет». Принятая за удачный
     * ответ пустота легла бы в кэш свежим снимком и вытеснила бы
     * последнюю хорошую цену: клиент увидел бы курс банка, где доллар
     * стоит единицу, хотя биржа отвечала минуту назад. Ошибка же
     * оставляет прежний снимок жить положенные ему пять минут.
     */
    if (book.size === 0) {
      throw new Error('Kraken отдала пустой список котировок');
    }
    return book;
  }

  const cache = createSnapshotCache({
    load: fetchTickers,
    ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    keep: SNAPSHOTS,
    provider: 'Kraken',
    ...(options.now ? { now: options.now } : {}),
  });

  if (options.warmUp) cache.warmUp();

  return {
    async quote(pair: RatePair, at?: Date): Promise<RateQuote | null> {
      // Спрошенное у биржи — две пары и их встречные стороны. Всё
      // остальное здесь молчит, не сходив в сеть: чужие пары
      // спрашивают у соседей по цепочке.
      const direct = symbolOf(pair);
      const inverse = symbolOf({ fromCode: pair.toCode, toCode: pair.fromCode });
      if (!direct && !inverse) return null;

      const snapshot = await cache.read(at);
      if (!snapshot) return null;

      const asOf = new Date(snapshot.at);

      // Прямая пара: сервис отдаёт то, что стоит в основании пары, и
      // получает по цене спроса.
      if (direct) {
        const book = snapshot.value.get(direct);
        return book ? { rate: Money.toAmount(book.bid), asOf } : null;
      }

      // Обратная: сервис покупает основание пары и платит по цене
      // предложения. Курс — обратный к ней.
      const book = inverse ? snapshot.value.get(inverse) : undefined;
      if (!book) return null;
      return { rate: Money.divide(Money.toAmount('1'), Money.toAmount(book.ask)), asOf };
    },
  };
}
