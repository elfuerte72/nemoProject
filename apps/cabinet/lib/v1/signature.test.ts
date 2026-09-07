import { describe, expect, it } from 'vitest';
import {
  bodyDigest,
  SeenSignatures,
  SIGNATURE_WINDOW_MS,
  signRequest,
  verifySignature,
} from './signature';

/**
 * Подпись HMAC запроса к API.
 *
 * Проверяется то, что глазом не видно: подпись сходится ровно на том,
 * что подписывали, живёт пять минут и второй раз не принимается.
 * Ошибка в любом из трёх выглядит как работающая подпись — до того дня,
 * когда перехваченный запрос повторят.
 */

const secret = 'sk_test_' + 'a'.repeat(32);
const now = new Date('2026-09-07T10:00:00Z');
const timestamp = String(Math.floor(now.getTime() / 1000));
const body = '{"from":"USDT","to":"RUB","amount":"100"}';

function signed(overrides: Partial<Parameters<typeof verifySignature>[0]> = {}) {
  const request = { method: 'POST', path: '/api/v1/quote', body, timestamp };
  return {
    secret,
    ...request,
    signature: signRequest(secret, request),
    now,
    seen: new SeenSignatures(),
    ...overrides,
  };
}

describe('подпись запроса', () => {
  it('сходится на том, что подписывали', () => {
    expect(verifySignature(signed())).toEqual({ ok: true });
  });

  it.each([
    ['метод', { method: 'GET' }],
    ['путь', { path: '/api/v1/exchange-requests' }],
    ['тело', { body: '{"from":"USDT","to":"RUB","amount":"1000"}' }],
    ['ключ', { secret: 'sk_test_' + 'b'.repeat(32) }],
  ] as const)('не сходится, если подменили %s', (_what, change) => {
    expect(verifySignature(signed(change))).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('без заголовков — «не хватает», а не «не сходится»', () => {
    expect(verifySignature(signed({ signature: null }))).toMatchObject({
      ok: false,
      code: 'missing',
    });
    expect(verifySignature(signed({ timestamp: null }))).toMatchObject({
      ok: false,
      code: 'missing',
    });
  });

  it('старше пяти минут не принимается — в обе стороны', () => {
    const late = new Date(now.getTime() + SIGNATURE_WINDOW_MS + 1000);
    expect(verifySignature(signed({ now: late }))).toMatchObject({ ok: false, code: 'stale' });

    const early = new Date(now.getTime() - SIGNATURE_WINDOW_MS - 1000);
    expect(verifySignature(signed({ now: early }))).toMatchObject({ ok: false, code: 'stale' });
  });

  it('отметка не числом — «не хватает»: подписывать её нечем', () => {
    expect(verifySignature(signed({ timestamp: 'вчера' }))).toMatchObject({
      ok: false,
      code: 'missing',
    });
  });

  /** Перехваченный запрос, повторённый внутри окна, второй заявки не заводит. */
  it('та же подпись второй раз не принимается', () => {
    const seen = new SeenSignatures();
    expect(verifySignature(signed({ seen }))).toEqual({ ok: true });
    expect(verifySignature(signed({ seen }))).toMatchObject({ ok: false, code: 'replayed' });
  });

  it('память о подписях не растёт бесконечно: просроченные забываются', () => {
    const seen = new SeenSignatures();
    for (let i = 0; i < 10; i += 1) {
      seen.remember(`sig-${i}`, now);
    }
    expect(seen.size).toBe(10);

    seen.remember('late', new Date(now.getTime() + SIGNATURE_WINDOW_MS * 2 + 1000));
    expect(seen.size).toBe(1);
  });

  it('пустое тело подписывается хешем пустой строки', () => {
    expect(bodyDigest('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
