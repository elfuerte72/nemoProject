import { describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, verifyTotp } from './totp.js';

/**
 * Второй фактор входа сотрудника.
 *
 * Проверяется против векторов RFC 6238 — независимого источника
 * ожидаемых значений. Тест, считающий ожидаемый код тем же кодом,
 * который проверяет, разойтись с ним не может и потому бесполезен.
 */

/** «12345678901234567890» из приложения B RFC 6238, в base32. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('код по RFC 6238', () => {
  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ])('в момент %i равен %s', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, { now: new Date(seconds * 1000), digits: 8 })).toBe(expected);
  });
});

describe('проверка кода', () => {
  const now = new Date(1_700_000_000_000);

  it('принимает код, посчитанный на текущем шаге', () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, { now }), { now })).toBe(true);
  });

  it('принимает код предыдущего шага: человек набирает не мгновенно', () => {
    const previous = totpCode(RFC_SECRET, { now: new Date(now.getTime() - 30_000) });

    expect(verifyTotp(RFC_SECRET, previous, { now })).toBe(true);
  });

  it('отвергает код, устаревший больше чем на шаг', () => {
    const stale = totpCode(RFC_SECRET, { now: new Date(now.getTime() - 120_000) });

    expect(verifyTotp(RFC_SECRET, stale, { now })).toBe(false);
  });

  it('отвергает чужой код', () => {
    const other = totpCode(generateTotpSecret(), { now });

    expect(verifyTotp(RFC_SECRET, other, { now })).toBe(false);
  });

  it('отвергает мусор вместо кода', () => {
    expect(verifyTotp(RFC_SECRET, '', { now })).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'абвгде', { now })).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', { now })).toBe(false);
  });

  it('не спотыкается о пробелы, которыми приложения разбивают код', () => {
    const code = totpCode(RFC_SECRET, { now });

    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { now })).toBe(true);
  });
});

describe('секрет', () => {
  it('выпускается в base32, который понимают приложения-аутентификаторы', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('каждый раз новый', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});
