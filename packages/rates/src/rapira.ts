import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money } from '@nemo/types';
import { createSnapshotCache } from './snapshots.js';

/**
 * Котировки Rapira — источник курса для криптовалютной стороны.
 *
 * Прячется за интерфейсом `RateSource` из `@nemo/core`: заявка на обмен
 * не должна знать, у кого именно спрошена цена. Провайдеров несколько —
 * фиатные пары биржа не котирует вовсе, а наличные котирует менеджер
 * вручную, и через этот интерфейс они не проходят.
 *
 * Ожидание чужого сервера живёт не здесь, а в общем кэше снимков:
 * правило «устаревшее отдаём сразу, за свежим идём в фоне» одно на всех
 * провайдеров, и второй копии у него быть не должно.
 */

const RATES_URL = 'https://api.rapira.net/open/market/rates';

/**
 * Через сколько котировка считается устаревшей и просит обновления.
 *
 * Он же — период, с которым снимок обновляется сам, без клиента. Пока
 * обновление уходило только по чьему-то запросу, десять секунд были
 * бесплатны: не спросили — не сходили. Теперь этот срок задаёт стук в
 * чужой публичный API круглые сутки, и десять секунд означали бы почти
 * девять тысяч запросов в день при полном отсутствии клиентов.
 *
 * Минута — та цена, которую сервис за это платит: курс на экране не
 * старше минуты. Для фиата и USDT это ничто, они не мемкоины и шагом в
 * секунду не ходят.
 *
 * По лимиту Rapira (5 запросов в секунду, до 100 в минуту) это один
 * запрос в минуту — независимо от того, сколько человек в приложении:
 * ответ у всех общий, а одновременные обращения склеиваются в одно.
 */
const DEFAULT_TTL_MS = 60_000;

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
 * пустоты. Но не бесконечно: по такому курсу подают заявку, а она
 * обязательство (docs/adr/0006).
 *
 * Час, а не пять минут. Срок этот отвечает на вопрос «биржа лежит — до
 * каких пор называть последнюю цену», и только на него: снимок
 * обновляется сам раз в минуту, и дожить до потолка он может, лишь
 * когда провайдер молчал весь час подряд. Пять минут отвечали заодно и
 * на другой вопрос — «сколько сервис ждёт клиента», — и на нём
 * ошибались: при паузе в полчаса между людьми каждый приходил на
 * мёртвый снимок.
 *
 * Мера риска здесь такая: сервис и без того держит зафиксированный курс
 * два часа с выдачи реквизитов, а наценка — двести базисных пунктов.
 * Час чужого молчания в эту наценку укладывается, пустой экран — нет.
 */
const DEFAULT_MAX_AGE_MS = 60 * 60_000;

/*
 * Сколько снимков курса помнить, здесь не задаётся: клиент подаёт
 * заявку по курсу, который увидел, и снимков надо ровно столько, чтобы
 * они покрывали срок жизни этого курса. Считает это `snapshots.ts` из
 * срока обновления и потолка устаревания — заданное числом расходилось
 * с ними молча.
 */

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

export function createRapiraRateSource(options: RapiraOptions = {}): RateSource {
  const request = options.fetch ?? globalThis.fetch;

  /**
   * Кэшируется весь ответ, а не отдельная пара: Rapira отдаёт все
   * котировки одним запросом, и разбирать его на пары значило бы ходить
   * к ней столько раз, сколько направлений на экране.
   */
  async function fetchRates(): Promise<Map<string, string>> {
    const response = await request(RATES_URL, {
      headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
      // Без срока `fetch` ждёт, пока держится соединение: на проде
      // замерен запрос длиной в тридцать две секунды.
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
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
    return rates;
  }

  const cache = createSnapshotCache({
    load: fetchRates,
    ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    provider: 'Rapira',
    ...(options.now ? { now: options.now } : {}),
  });

  if (options.warmUp) cache.warmUp();

  return {
    async quote(pair: RatePair, at?: Date): Promise<RateQuote | null> {
      const snapshot = await cache.read(at);
      if (!snapshot) return null;

      const rates = snapshot.value;
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

      // Пересчёта через опорную валюту здесь нет — и не появится.
      // Спросили у биржи — значит хотели её цену, а не самодельную;
      // провайдер, подменяющий недостающую котировку произведением двух
      // чужих, отвечает не о том, о чём его спрашивали.
      //
      // Составление живёт отдельным источником (`cross.ts`), стоит в
      // цепочке последним и берётся за дело, только когда прямой цены
      // нет ни у кого. Так работает рубль в батах: его не котирует никто.
      return null;
    },
  };
}
