import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money } from '@nemo/types';
import { createSnapshotCache } from './snapshots.js';

/**
 * Курсы фиатных валют — вторая реализация источника курса.
 *
 * Биржи фиата, у которой можно спросить бат за USDT, не существует:
 * фиатные пары котируются банками, а публично и бесплатно их отдают
 * только справочные источники. Взят Европейский центральный банк — он
 * публикует опорные курсы раз в рабочий день, отдаёт их без ключа и без
 * лимитов, и в его списке есть все валюты, которыми торгует сервис
 * (docs/adr/0007).
 *
 * Опорная валюта — доллар, и USDT считается долларом. Прямой пары
 * USDT/THB не котирует никто, а собрать её через рубль значило бы
 * заложить в цену бата премию USDT на рублёвом рынке — те самые три
 * процента, из-за которых сервис обещал бы 1,03 доллара за монету,
 * стоящую доллар. Отклонение привязки USDT — доли процента против
 * наценки сервиса в два.
 *
 * Рублёвые направления сюда не попадают: рубля у ЕЦБ нет с 2022 года, и
 * их по-прежнему котирует биржа.
 */

const RATES_URL = 'https://api.frankfurter.dev/v1/latest?base=USD';

/**
 * Валюта, к которой приведены все котировки, — и она же та, которой
 * считается USDT.
 */
const BASE = 'USD';

/**
 * Стейблкоины, привязанные к доллару.
 *
 * Таблицей, а не проверкой на равенство: список расширяется валютой, а
 * не правкой условия, и видно, что именно сервис считает долларом.
 */
const DOLLAR_PEGGED: Record<string, string> = { USDT: BASE };

/**
 * Через сколько снимок просит обновления.
 *
 * Час, а не минута, как у биржи: ЕЦБ публикует курсы раз в рабочий
 * день, и ходить к нему чаще незачем — ответ будет тот же. Этим же
 * сроком снимок обновляет себя сам, и здесь он не компромисс, а
 * отсутствие смысла спрашивать чаще.
 */
const DEFAULT_TTL_MS = 60 * 60_000;

/** Сколько ждать провайдера, прежде чем считать его молчащим. */
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Насколько старый снимок ещё можно показывать.
 *
 * Сутки — против часа у биржи, и это не послабление, а разная
 * природа чисел: криптовалютная котировка живёт минуту, а опорный
 * курс ЕЦБ и так держится сутки по построению. Сутки молчания
 * провайдера — это край, за которым честнее сказать «курс назовёт
 * менеджер», чем показывать позавчерашнюю цену как обязательство.
 */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60_000;

/*
 * Сколько снимков помнить, здесь не задаётся: их нужно ровно столько,
 * чтобы память покрывала срок, в течение которого курс можно
 * показывать. Считает это `snapshots.ts` — из срока обновления и
 * потолка устаревания.
 */

export interface FiatRatesOptions {
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly maxAgeMs?: number;
  /** Сходить за курсами при создании источника, не дожидаясь клиента. */
  readonly warmUp?: boolean;
  /** Подменяется в тестах: сети в них нет. */
  readonly fetch?: typeof globalThis.fetch;
  /** Подменяется в тестах, чтобы проверить устаревание кэша. */
  readonly now?: () => number;
}

/** Ответ провайдера: сколько единиц валюты дают за одну опорную. */
interface FiatRatesResponse {
  readonly rates?: Record<string, unknown>;
}

/**
 * Курсы приходят числами JSON, то есть через `double`. На границе они
 * сразу переводятся в десятичную строку: дальше в деньгах участвует
 * только `Money`.
 */
function toRate(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Money.toAmount(value);
}

/** Код валюты так, как его знает провайдер: USDT для него — доллар. */
function asFiat(code: string): string {
  const upper = code.toUpperCase();
  return DOLLAR_PEGGED[upper] ?? upper;
}

export function createFiatRateSource(options: FiatRatesOptions = {}): RateSource {
  const request = options.fetch ?? globalThis.fetch;

  async function fetchRates(): Promise<Map<string, string>> {
    const response = await request(RATES_URL, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`ЕЦБ ответил ${response.status}`);
    }

    const body = (await response.json()) as FiatRatesResponse;
    // Опорная валюта в ответе не приходит — она и есть единица. Без неё
    // направления, у которых доллар с одной стороны, остались бы без
    // курса, хотя считать там нечего.
    const rates = new Map<string, string>([[BASE, '1']]);
    for (const [code, value] of Object.entries(body.rates ?? {})) {
      const rate = toRate(value);
      if (rate !== null) rates.set(code.toUpperCase(), rate);
    }
    return rates;
  }

  const cache = createSnapshotCache({
    load: fetchRates,
    ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    provider: 'ЕЦБ',
    ...(options.now ? { now: options.now } : {}),
  });

  if (options.warmUp) cache.warmUp();

  return {
    async quote(pair: RatePair, at?: Date): Promise<RateQuote | null> {
      const snapshot = await cache.read(at);
      if (!snapshot) return null;

      const rates = snapshot.value;
      const from = rates.get(asFiat(pair.fromCode));
      const to = rates.get(asFiat(pair.toCode));
      // Хотя бы одной стороны провайдер не знает — курса нет. Так
      // отвечают все рублёвые направления: рубля у ЕЦБ нет, и котирует
      // их биржа.
      if (from === undefined || to === undefined) return null;

      const perUsd = Money.toAmount(from);
      if (Money.isZero(perUsd)) return null;

      // Обе стороны выражены в долларах, и доллар сокращается: сколько
      // бат за доллар, делённое на сколько USDT за доллар, и есть цена
      // бата в USDT.
      return { rate: Money.divide(Money.toAmount(to), perUsd), asOf: new Date(snapshot.at) };
    },
  };
}
