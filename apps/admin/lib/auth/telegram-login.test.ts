import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TelegramLoginError, verifyTelegramLogin } from './telegram-login.js';

const BOT_TOKEN = '123456:TEST-TOKEN';
const NOW = new Date('2026-08-01T12:00:00Z');

function signLogin(fields: Record<string, string>): Record<string, string> {
  const dataCheckString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHash('sha256').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return { ...fields, hash };
}

function validFields(overrides: Record<string, string> = {}) {
  return {
    id: '7123456789',
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 30),
    username: 'manager',
    ...overrides,
  };
}

describe('verifyTelegramLogin', () => {
  it('принимает подпись виджета входа', () => {
    const result = verifyTelegramLogin(signLogin(validFields()), BOT_TOKEN, NOW);
    expect(result.telegramUserId).toBe(7_123_456_789n);
  });

  it('использует SHA256 от токена, а не схему Mini App', () => {
    // Подпись, сделанная по схеме initData, здесь приниматься не должна:
    // иначе один и тот же ключ открывал бы и клиентскую часть, и админку.
    const fields = validFields();
    const dataCheckString = Object.entries(fields)
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n');
    const miniAppSecret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = createHmac('sha256', miniAppSecret).update(dataCheckString).digest('hex');

    expect(() => verifyTelegramLogin({ ...fields, hash }, BOT_TOKEN, NOW)).toThrow(
      TelegramLoginError,
    );
  });

  it('отвергает подмену идентификатора', () => {
    const signed = signLogin(validFields());
    signed.id = '7999999999';
    expect(() => verifyTelegramLogin(signed, BOT_TOKEN, NOW)).toThrow(TelegramLoginError);
  });

  it('отвергает подпись чужим токеном', () => {
    expect(() => verifyTelegramLogin(signLogin(validFields()), 'чужой', NOW)).toThrow(
      TelegramLoginError,
    );
  });

  it('отвергает вход старше пяти минут', () => {
    const stale = String(Math.floor(NOW.getTime() / 1000) - 6 * 60);
    const signed = signLogin(validFields({ auth_date: stale }));
    expect(() => verifyTelegramLogin(signed, BOT_TOKEN, NOW)).toThrow(/просрочен/);
  });

  it('отвергает данные без подписи', () => {
    expect(() => verifyTelegramLogin(validFields(), BOT_TOKEN, NOW)).toThrow(/нет подписи/);
  });
});
