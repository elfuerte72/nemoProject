import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money } from '@nemo/types';

/**
 * Котировки Rapira — одна из реализаций источника курса.
 *
 * Прячется за интерфейсом `RateSource` из `@nemo/core`: заявка на обмен
 * не должна знать, у кого именно спрошена цена. Провайдеров будет
 * несколько — наличные, например, котирует менеджер вручную, и через
 * этот интерфейс они не проходят вовсе.
 *
 * Курс справочный (docs/adr/0004), поэтому котировка не хранится и ни к
 * чему не обязывает: она нужна ровно на время, пока клиент смотрит на
 * экран обмена.
 */

const RATES_URL = 'https://api.rapira.net/open/market/rates';

/**
 * Через сколько котировка считается устаревшей и просит обновления.
 *
 * Десять секунд, а не больше, именно потому, что обновление никого не
 * задерживает: устаревшую отдают сразу, а за свежей идут в фоне. Пока
 * обновление стояло в пути ответа, короткий срок был дорогим — каждый
 * раз кто-то ждал биржу; теперь он бесплатный, и курс держится свежее.
 *
 * По лимиту Rapira (5 запросов в секунду, до 100 в минуту) это шесть
 * запросов в минуту — независимо от того, сколько человек в приложении:
 * ответ у всех общий, а одновременные обращения склеиваются в одно.
 */
const DEFAULT_TTL_MS = 10_000;

/**
 * Сколько ждать биржу, прежде чем считать её молчащей.
 *
 * Ограничения не было вовсе, и на проде замерен запрос длиной в
 * тридцать две секунды: `fetch` без срока ждёт столько, сколько
 * держится соединение. Три секунды — заметно больше обычного ответа и
 * заметно меньше человеческого терпения.
 */
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Насколько старую котировку ещё можно показывать.
 *
 * Пока биржа молчит, отдаётся последняя известная — она информативнее
 * пустоты. Но не бесконечно: курс, разошедшийся с рынком на полчаса,
 * хуже честного «курс назовёт менеджер», потому что по нему подают
 * заявку, а она обязательство (docs/adr/0006).
 */
const DEFAULT_MAX_AGE_MS = 5 * 60_000;

/**
 * Сколько снимков курса помнить.
 *
 * Клиент подаёт заявку по курсу, который увидел, и присылает отметку
 * его времени. Чтобы ответить именно тем курсом, снимки надо хранить, а
 * не только последний: между показом и нажатием кэш успевает
 * обновиться. Тридцати снимков при обновлении раз в десять секунд
 * хватает на те же пять минут, что и потолок устаревания.
 */
const SNAPSHOTS = 30;

export interface RapiraOptions {
  /**
   * Ключ Rapira. Не обязателен: список котировок отдаётся публично.
   * Если задан — уходит в заголовке.
   */
  readonly apiKey?: string | undefined;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly maxAgeMs?: number;
  /**
   * Сходить за котировками сразу при создании источника, не дожидаясь
   * первого клиента. Единственное ожидание, которое здесь осталось, —
   * первое обращение после перезапуска процесса, и прогрев съедает его
   * до того, как кто-то придёт. В тестах не нужен: сети в них нет.
   */
  readonly warmUp?: boolean;
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

/** Снимок всех котировок на момент времени. */
interface Snapshot {
  readonly at: number;
  readonly rates: Map<string, string>;
}

export function createRapiraRateSource(options: RapiraOptions = {}): RateSource {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  /**
   * Кэшируется весь ответ, а не отдельная пара: Rapira отдаёт все
   * котировки одним запросом, и разбирать его на пары значило бы ходить
   * к ней столько раз, сколько направлений на экране.
   *
   * Снимков несколько, новейший последний: по одному отвечают на «дай
   * текущий», по остальным — на «дай тот, который я показывал клиенту».
   */
  const snapshots: Snapshot[] = [];
  let inFlight: Promise<Snapshot> | undefined;

  const newest = (): Snapshot | undefined => snapshots[snapshots.length - 1];

  /**
   * Обновление, которое никого не ждёт.
   *
   * Один запрос на всех, кто спросил, пока он идёт: даже склеенные,
   * запросы к чужому API нужны раз в срок жизни кэша, а не по числу
   * посетителей.
   */
  function refresh(): Promise<Snapshot> {
    inFlight ??= fetchRates().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  /**
   * Что показывать прямо сейчас.
   *
   * Устаревшее отдаётся немедленно, а за свежим уходят в фоне: запрос
   * клиента не должен стоять в очереди за чужим сервером. Ждут здесь
   * ровно в одном случае — когда показывать нечего вовсе, то есть при
   * первом обращении после запуска процесса.
   */
  async function current(): Promise<Snapshot | undefined> {
    const known = newest();
    if (!known) return refresh();

    if (now() - known.at >= ttlMs) {
      // Ошибку здесь глушим намеренно: это фоновое обновление, и
      // некому её показать — тот, кто её вызвал, уже получил ответ.
      void refresh().catch((error: unknown) => {
        console.error('Rapira не отдала котировки', error);
      });
    }
    return known;
  }

  async function fetchRates(): Promise<Snapshot> {
    const response = await request(RATES_URL, {
      headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
      // Без срока `fetch` ждёт, пока держится соединение: на проде
      // замерен запрос длиной в тридцать две секунды.
      signal: AbortSignal.timeout(timeoutMs),
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

    const snapshot: Snapshot = { at: now(), rates };
    snapshots.push(snapshot);
    if (snapshots.length > SNAPSHOTS) snapshots.shift();
    return snapshot;
  }

  if (options.warmUp) {
    void refresh().catch((error: unknown) => {
      console.error('Rapira не отдала котировки при прогреве', error);
    });
  }

  return {
    async quote(pair: RatePair, at?: Date): Promise<RateQuote | null> {
      let snapshot: Snapshot | undefined;
      try {
        // Курс, который клиент видел, ищется среди снимков по отметке
        // времени. Не нашли — отвечаем текущим: отметка могла устареть
        // из памяти, и это не повод отказывать в подаче.
        snapshot =
          (at && snapshots.find((one) => one.at === at.getTime())) ?? (await current());
      } catch (error) {
        // Недоступность провайдера — рабочее состояние, а не авария:
        // заявку клиент подаст и без курса, а курс назовёт менеджер.
        console.error('Rapira не отдала котировки', error);
        snapshot = newest();
      }

      // Слишком старое не показывается: по такому курсу подают заявку, а
      // она обязательство сервиса.
      if (!snapshot || now() - snapshot.at > maxAgeMs) return null;

      const { rates } = snapshot;
      const asOf = new Date(snapshot.at);

      const direct = rates.get(`${pair.fromCode}/${pair.toCode}`.toUpperCase());
      if (direct !== undefined) {
        return { rate: Money.toAmount(direct), asOf };
      }

      // Обратная пара: биржа котирует USDT/RUB, а спросили RUB → USDT.
      // Без этого половина направлений осталась бы без курса, хотя цена
      // у них есть.
      const inverse = rates.get(`${pair.toCode}/${pair.fromCode}`.toUpperCase());
      if (inverse !== undefined && !Money.isZero(Money.toAmount(inverse))) {
        return { rate: Money.divide(Money.toAmount('1'), Money.toAmount(inverse)), asOf };
      }

      // Пересчёта через опорную валюту здесь нет. Он собирал «сколько
      // рублей за биткойн» из двух котировок — для пары, которой в
      // сервисе больше не существует: USDT и рубль биржа котирует
      // напрямую. Вернуть его придётся вместе с валютой, у которой нет
      // прямой рублёвой пары.
      return null;
    },
  };
}

/**
 * Источник курса для приложения. Ключ необязателен, поэтому отсутствие
 * `RAPIRA_KEY` не мешает развернуться: котировки просто пойдут
 * анонимными запросами.
 */
export function rapiraFromEnvironment(): RateSource {
  return createRapiraRateSource({ apiKey: process.env.RAPIRA_KEY, warmUp: true });
}
