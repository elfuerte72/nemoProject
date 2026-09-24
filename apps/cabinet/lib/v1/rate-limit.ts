/**
 * Пределы вызовов на ключ API: сто в минуту, тысяча в час — как у
 * Love&Pay на старте (spec, «API v1»).
 *
 * В памяти процесса, окнами по часам: минута и час считаются от
 * границы, а не скользящим окном. Скользящее точнее на границе, но
 * стоит списка отметок на каждый вызов; предел здесь — страховка от
 * цикла без паузы, а не тариф, и точность до секунды ему не нужна.
 *
 * Ключей у мерчантов десятки, и память ограничена их числом: сюда
 * попадает только узнанный ключ. Просроченные окна чистятся при записи,
 * а не по таймеру, — по той же причине, что и счётчик попыток входа.
 */

export const RATE_LIMITS = { perMinute: 100, perHour: 1000 } as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Сколько ключей помнить, прежде чем вычищать стухшие окна. */
const KEYS_KEPT = 1000;

interface Windows {
  minuteStart: number;
  minuteCount: number;
  hourStart: number;
  hourCount: number;
}

/**
 * Окно глазами вызывающего: пределы, сколько осталось и когда откроется
 * то окно, что держит, — часовое, если час выбран, иначе минутное.
 * Уходит заголовками на каждом ответе с узнанным ключом.
 */
export interface RateWindow {
  readonly limitMinute: number;
  readonly remainingMinute: number;
  readonly limitHour: number;
  readonly remainingHour: number;
  /** Момент в миллисекундах. */
  readonly resetAt: number;
}

export type RateSlot =
  | { readonly ok: true; readonly window: RateWindow }
  | { readonly ok: false; readonly retryAfterSeconds: number; readonly window: RateWindow };

/**
 * На `globalThis`, как счётчик попыток и ядро: Next пересобирает модули
 * в разработке, и с переменной модуля предел обнулялся бы на каждой
 * правке.
 */
const KEY = Symbol.for('nemo.cabinet.rate-limits');
type Holder = typeof globalThis & { [KEY]?: Map<string, Windows> };

function windows(): Map<string, Windows> {
  const holder = globalThis as Holder;
  holder[KEY] ??= new Map();
  return holder[KEY];
}

export function takeRateSlot(keyId: string, now: number = Date.now()): RateSlot {
  const map = windows();
  const minuteStart = now - (now % MINUTE_MS);
  const hourStart = now - (now % HOUR_MS);

  let current = map.get(keyId);
  if (!current) {
    sweep(map, now);
    current = { minuteStart, minuteCount: 0, hourStart, hourCount: 0 };
    map.set(keyId, current);
  }
  if (current.minuteStart !== minuteStart) {
    current.minuteStart = minuteStart;
    current.minuteCount = 0;
  }
  if (current.hourStart !== hourStart) {
    current.hourStart = hourStart;
    current.hourCount = 0;
  }

  // Часовой предел проверяется первым: он даёт большее «подождите», и
  // назвать меньшее значило бы звать обратно через минуту впустую.
  if (current.hourCount >= RATE_LIMITS.perHour) {
    return {
      ok: false,
      retryAfterSeconds: secondsUntil(hourStart + HOUR_MS, now),
      window: windowOf(current),
    };
  }
  if (current.minuteCount >= RATE_LIMITS.perMinute) {
    return {
      ok: false,
      retryAfterSeconds: secondsUntil(minuteStart + MINUTE_MS, now),
      window: windowOf(current),
    };
  }

  current.minuteCount += 1;
  current.hourCount += 1;
  return { ok: true, window: windowOf(current) };
}

function windowOf(current: Windows): RateWindow {
  const remainingHour = Math.max(RATE_LIMITS.perHour - current.hourCount, 0);
  return {
    limitMinute: RATE_LIMITS.perMinute,
    remainingMinute: Math.max(RATE_LIMITS.perMinute - current.minuteCount, 0),
    limitHour: RATE_LIMITS.perHour,
    remainingHour,
    resetAt: remainingHour === 0 ? current.hourStart + HOUR_MS : current.minuteStart + MINUTE_MS,
  };
}

/**
 * Заголовки остатка — те же имена, что у Love&Pay v2: мерчант, который
 * ходит к обоим, читает их одним кодом. Время открытия — ISO, как и
 * всё время в договоре.
 */
export function rateLimitHeaders(window: RateWindow): Record<string, string> {
  return {
    'x-ratelimit-limit-minute': String(window.limitMinute),
    'x-ratelimit-remaining-minute': String(window.remainingMinute),
    'x-ratelimit-limit-hour': String(window.limitHour),
    'x-ratelimit-remaining-hour': String(window.remainingHour),
    'x-ratelimit-reset': new Date(window.resetAt).toISOString(),
  };
}

function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}

function sweep(map: Map<string, Windows>, now: number): void {
  if (map.size < KEYS_KEPT) return;
  for (const [keyId, one] of map) {
    if (one.hourStart + HOUR_MS <= now) map.delete(keyId);
  }
}

/** Забыть всё: нужно тестам, которым иначе мешает предыдущий. */
export function forgetRateLimits(): void {
  windows().clear();
}
