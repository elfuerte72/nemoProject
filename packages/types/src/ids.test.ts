import { describe, expect, it } from 'vitest';
import { isUuid, parseTelegramUserId } from './ids.js';

/**
 * Идентификатор из адреса — ещё не идентификатор.
 *
 * Адрес правит кто угодно, а база на строку не того вида отвечает не
 * «нет такого», а ошибкой: до 17 сентября 2026 `/exchange-requests/abc`
 * в панели, `/requests/abc` в кабинете и номер клиента длиннее bigint
 * отвечали страницей аварии, а API — `500 internal` вместо `404`.
 */
describe('идентификатор заявки, мерчанта, записи', () => {
  it('UUID узнаётся в любом регистре', () => {
    expect(isUuid('3f1c2a9e-5b7d-4c0e-9a11-2f6d8e4b7c31')).toBe(true);
    expect(isUuid('3F1C2A9E-5B7D-4C0E-9A11-2F6D8E4B7C31')).toBe(true);
  });

  it('прочее — не UUID: база его не разберёт', () => {
    expect(isUuid('abc')).toBe(false);
    expect(isUuid('booking-1024')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('3f1c2a9e-5b7d-4c0e-9a11-2f6d8e4b7c3')).toBe(false);
    expect(isUuid('3f1c2a9e-5b7d-4c0e-9a11-2f6d8e4b7c31 ')).toBe(false);
    expect(isUuid('3f1c2a9e5b7d4c0e9a112f6d8e4b7c31')).toBe(false);
    expect(isUuid('zf1c2a9e-5b7d-4c0e-9a11-2f6d8e4b7c31')).toBe(false);
  });
});

describe('Telegram ID клиента', () => {
  it('положительное целое цифрами', () => {
    expect(parseTelegramUserId('7123456789')).toBe(7123456789n);
    expect(parseTelegramUserId('1')).toBe(1n);
  });

  it('до верха bigint в базе включительно', () => {
    expect(parseTelegramUserId('9223372036854775807')).toBe(9223372036854775807n);
    expect(parseTelegramUserId('9223372036854775808')).toBeNull();
    expect(parseTelegramUserId('99999999999999999999999')).toBeNull();
  });

  it('ноль, знак, пробелы, дробь и буквы — не идентификатор', () => {
    for (const raw of ['0', '000', '-5', '+5', ' 5', '5 ', '1.5', '1e3', 'abc', '']) {
      expect(parseTelegramUserId(raw), raw).toBeNull();
    }
  });
});
