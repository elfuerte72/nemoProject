import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money } from '@nemo/types';

/**
 * Котировки Rapira — одна из реализаций источника курса.
 *
 * Прячется за интерфейсом `RateSource` из `@nemo/core`: заявка на обмен
 * не должна знать, у кого именно спрошена цена. Список направлений ждёт
 * блокера C1, а провайдеров под них будет несколько — от наличных, где
 * ставку называет менеджер, до бирж с разными парами.
 *
 * Курс справочный (docs/adr/0004), поэтому котировка не хранится и ни к
 * чему не обязывает: она нужна ровно на время, пока клиент смотрит на
 * экран обмена.
 */

const RATES_URL = 'https://api.rapira.net/open/market/rates';

/** Сколько котировка живёт в памяти. */
const DEFAULT_TTL_MS = 15_000;

export interface RapiraOptions {
  /**
   * Ключ Rapira. Не обязателен: список котировок отдаётся публично.
   * Если задан — уходит в заголовке.
   */
  readonly apiKey?: string | undefined;
  readonly ttlMs?: number;
  /** Подменяется в тестах: сеть в них не нужна. */
  readonly fetch?: typeof globalThis.fetch;
  /** Подменяется в тестах, чтобы проверить устаревание кэша. */
  readonly now?: () => number;
}

/**
 * Ответ Rapira. Из всех полей нужна цена закрытия: `symbol` вида
 * «USDT/RUB» означает цену первой валюты, выраженную во второй.
 */
interface RapiraRate {
  readonly symbol?: unknown;
  readonly close?: unknown;
}

/**
 * Котировки приходят числами JSON, то есть уже через `double`. Для
 * справочного курса этого достаточно: он показывается клиенту как
 * ориентир и ни в какую денежную операцию не входит — исполняется
 * заявка по курсу, который назвал менеджер. Дальше числа не идут:
 * `Money.toAmount` переводит их в десятичную строку сразу на границе.
 */
function toRate(value: unknown): ReturnType<typeof Money.toAmount> | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Money.toAmount(value);
}

export function createRapiraRateSource(options: RapiraOptions = {}): RateSource {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  /**
   * Кэшируется весь ответ, а не отдельная пара: Rapira отдаёт все
   * котировки одним запросом, и разбирать его на пары значило бы ходить
   * к ней столько раз, сколько направлений на экране.
   */
  let cached: { at: number; rates: Map<string, string> } | undefined;
  let inFlight: Promise<Map<string, string>> | undefined;

  async function load(): Promise<Map<string, string>> {
    const fresh = cached && now() - cached.at < ttlMs;
    if (cached && fresh) return cached.rates;

    // Один запрос на всех, кто спросил, пока он идёт: ввод каждой цифры
    // суммы дёргает экран заново, и без этого к чужому API ушёл бы
    // запрос на каждое нажатие клавиши.
    inFlight ??= fetchRates().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  async function fetchRates(): Promise<Map<string, string>> {
    const response = await request(RATES_URL, {
      headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
    });
    if (!response.ok) {
      throw new Error(`Rapira ответила ${response.status}`);
    }

    const body = (await response.json()) as { data?: readonly RapiraRate[] };
    const rates = new Map<string, string>();
    for (const item of body.data ?? []) {
      const rate = toRate(item.close);
      if (typeof item.symbol === 'string' && rate !== null) {
        rates.set(item.symbol.toUpperCase(), rate);
      }
    }

    cached = { at: now(), rates };
    return rates;
  }

  return {
    async quote(pair: RatePair): Promise<RateQuote | null> {
      let rates: Map<string, string>;
      try {
        rates = await load();
      } catch (error) {
        // Недоступность провайдера — рабочее состояние, а не авария:
        // заявку клиент подаст и без курса, а курс назовёт менеджер.
        console.error('Rapira не отдала котировки', error);
        return null;
      }

      const direct = rates.get(`${pair.fromCode}/${pair.toCode}`.toUpperCase());
      if (direct !== undefined) {
        return { rate: Money.toAmount(direct), asOf: new Date(cached?.at ?? now()) };
      }

      // Обратная пара: биржа котирует USDT/RUB, а спросили RUB → USDT.
      // Без этого половина направлений осталась бы без курса, хотя цена
      // у них есть.
      const inverse = rates.get(`${pair.toCode}/${pair.fromCode}`.toUpperCase());
      if (inverse === undefined || Money.isZero(Money.toAmount(inverse))) {
        return null;
      }
      return {
        rate: Money.divide(Money.toAmount('1'), Money.toAmount(inverse)),
        asOf: new Date(cached?.at ?? now()),
      };
    },
  };
}

/**
 * Источник курса для приложения. Ключ необязателен, поэтому отсутствие
 * `RAPIRA_KEY` не мешает развернуться: котировки просто пойдут
 * анонимными запросами.
 */
export function rapiraFromEnvironment(): RateSource {
  return createRapiraRateSource({ apiKey: process.env.RAPIRA_KEY });
}
