import { beforeEach, describe, expect, it } from 'vitest';
import { forgetRateLimits, RATE_LIMITS, takeRateSlot } from './rate-limit';

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
      expect(takeRateSlot('key-1', t0 + i * 100)).toEqual({ ok: true });
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
    expect(takeRateSlot('key-1', t0 + 61_000)).toEqual({ ok: true });
  });

  it('тысяча в час держится и при тихой минуте', () => {
    // Десять минут по сто — тысяча за час выбрана, минута при этом свежая.
    for (let minute = 0; minute < 10; minute += 1) {
      for (let i = 0; i < RATE_LIMITS.perMinute; i += 1) {
        expect(takeRateSlot('key-1', t0 + minute * 60_000 + i)).toEqual({ ok: true });
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
    expect(takeRateSlot('key-2', t0)).toEqual({ ok: true });
  });
});
