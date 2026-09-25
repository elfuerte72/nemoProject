import { beforeEach, describe, expect, it } from 'vitest';
import { forgetRateLimits, RATE_LIMITS, rateLimitHeaders, takeRateSlot } from './rate-limit';

/**
 * Пределы вызовов на ключ. Руками это сто запросов подряд, а ошибка
 * выглядит как работающий API — до первого мерчанта с циклом без паузы.
 */

beforeEach(() => {
  forgetRateLimits();
});

const t0 = Date.parse('2026-09-07T10:00:00Z');

describe('лимит вызовов', () => {
  it('пускает сто в минуту, сто первый — с указанием, когда можно снова', () => {
    for (let i = 0; i < RATE_LIMITS.perMinute; i += 1) {
      expect(takeRateSlot('key-1', t0 + i * 100)).toMatchObject({ ok: true });
    }
    const denied = takeRateSlot('key-1', t0 + 10_000);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfterSeconds).toBeGreaterThan(0);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('через минуту счёт открывается заново', () => {
    for (let i = 0; i < RATE_LIMITS.perMinute; i += 1) takeRateSlot('key-1', t0);
    expect(takeRateSlot('key-1', t0 + 61_000)).toMatchObject({ ok: true });
  });

  it('тысяча в час держится и при тихой минуте', () => {
    // Десять минут по сто — тысяча за час выбрана, минута при этом свежая.
    for (let minute = 0; minute < 10; minute += 1) {
      for (let i = 0; i < RATE_LIMITS.perMinute; i += 1) {
        expect(takeRateSlot('key-1', t0 + minute * 60_000 + i)).toMatchObject({ ok: true });
      }
    }
    const denied = takeRateSlot('key-1', t0 + 11 * 60_000);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfterSeconds).toBeGreaterThan(60);
    }
  });

  it('считает по ключу: чужой перебор соседа не запирает', () => {
    for (let i = 0; i < RATE_LIMITS.perMinute; i += 1) takeRateSlot('key-1', t0);
    expect(takeRateSlot('key-1', t0)).toMatchObject({ ok: false });
    expect(takeRateSlot('key-2', t0)).toMatchObject({ ok: true });
  });

  /*
   * Остаток уходит мерчанту заголовками на каждом ответе: по ним его
   * код замедляется сам, не дожидаясь 429.
   */
  it('называет остаток в минуте и в часе и когда откроется окно', () => {
    const slot = takeRateSlot('key-1', t0 + 15_000);
    expect(slot).toEqual({
      ok: true,
      window: {
        limitMinute: RATE_LIMITS.perMinute,
        remainingMinute: RATE_LIMITS.perMinute - 1,
        limitHour: RATE_LIMITS.perHour,
        remainingHour: RATE_LIMITS.perHour - 1,
        resetAt: t0 + 60_000,
      },
    });
  });

  it('когда исчерпан час, окно открывается на границе часа, а не минуты', () => {
    for (let minute = 0; minute < 10; minute += 1) {
      for (let i = 0; i < RATE_LIMITS.perMinute; i += 1) takeRateSlot('key-1', t0 + minute * 60_000);
    }
    const denied = takeRateSlot('key-1', t0 + 11 * 60_000);
    expect(denied).toMatchObject({
      ok: false,
      window: { remainingHour: 0, resetAt: t0 + 60 * 60_000 },
    });
  });
});

describe('заголовки предела', () => {
  it('пишутся по окну: пределы, остаток и время открытия в ISO', () => {
    expect(
      rateLimitHeaders({
        limitMinute: 100,
        remainingMinute: 42,
        limitHour: 1000,
        remainingHour: 900,
        resetAt: Date.parse('2026-09-07T10:01:00Z'),
      }),
    ).toEqual({
      'x-ratelimit-limit-minute': '100',
      'x-ratelimit-remaining-minute': '42',
      'x-ratelimit-limit-hour': '1000',
      'x-ratelimit-remaining-hour': '900',
      'x-ratelimit-reset': '2026-09-07T10:01:00.000Z',
    });
  });
});
