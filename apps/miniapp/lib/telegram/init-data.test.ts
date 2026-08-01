import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InitDataError, verifyInitData } from './init-data.js';

const BOT_TOKEN = '123456:TEST-TOKEN';
const NOW = new Date('2026-08-01T12:00:00Z');

/** Собирает подписанный initData так же, как это делает Telegram. */
function signInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function validFields(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 60),
    user: JSON.stringify({ id: 7_123_456_789, username: 'penkin' }),
    ...overrides,
  };
}

describe('verifyInitData', () => {
  it('принимает подпись, сделанную токеном бота', () => {
    const result = verifyInitData(signInitData(validFields()), BOT_TOKEN, NOW);
    expect(result.telegramUserId).toBe(7_123_456_789n);
    expect(result.username).toBe('penkin');
  });

  it('отвергает подпись, сделанную чужим токеном', () => {
    const raw = signInitData(validFields());
    expect(() => verifyInitData(raw, 'другой-токен', NOW)).toThrow(InitDataError);
  });

  it('отвергает подмену идентификатора пользователя', () => {
    // Ровно та атака, ради которой проверка и существует: клиент правит id
    // в открытой строке, чтобы выдать себя за другого.
    const raw = signInitData(validFields());
    const tampered = raw.replace('7123456789', '7999999999');
    expect(() => verifyInitData(tampered, BOT_TOKEN, NOW)).toThrow(InitDataError);
  });

  it('отвергает просроченный initData', () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 25 * 60 * 60);
    const raw = signInitData(validFields({ auth_date: old }));
    expect(() => verifyInitData(raw, BOT_TOKEN, NOW)).toThrow(/просрочен/);
  });

  it('отвергает auth_date из будущего', () => {
    const future = String(Math.floor(NOW.getTime() / 1000) + 3600);
    const raw = signInitData(validFields({ auth_date: future }));
    expect(() => verifyInitData(raw, BOT_TOKEN, NOW)).toThrow(/будущего/);
  });

  it('отвергает строку без подписи', () => {
    expect(() => verifyInitData('user=%7B%7D', BOT_TOKEN, NOW)).toThrow(/нет подписи/);
  });

  it('возвращает параметр запуска из реферальной ссылки', () => {
    const raw = signInitData(validFields({ start_param: 'ref_7123456789' }));
    expect(verifyInitData(raw, BOT_TOKEN, NOW).startParam).toBe('ref_7123456789');
  });

  it('не спотыкается о новое поле signature, которого нет в строке проверки', () => {
    const raw = `${signInitData(validFields())}&signature=abc`;
    expect(() => verifyInitData(raw, BOT_TOKEN, NOW)).not.toThrow();
  });
});
