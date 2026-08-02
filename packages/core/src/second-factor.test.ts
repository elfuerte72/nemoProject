import { describe, expect, it } from 'vitest';
import { otpauthUri } from './second-factor.js';

const SECRET = 'X54LSROYJZIBIDXYRXRMOTSCZF2JGNSH';
const SUBJECT = { telegramUserId: 483902117n, role: 'admin' } as const;

describe('ссылка для аутентификатора', () => {
  it('собрана по стандарту otpauth', () => {
    const uri = new URL(otpauthUri(SUBJECT, SECRET));

    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(SECRET);
    expect(uri.searchParams.get('issuer')).toBe('nemo');
    expect(uri.searchParams.get('period')).toBe('30');
    expect(uri.searchParams.get('digits')).toBe('6');
  });

  it('подписана Telegram и ролью: одним «nemo» две записи не различить', () => {
    expect(decodeURIComponent(otpauthUri(SUBJECT, SECRET))).toContain('nemo:483902117 · admin');
  });

  it('не ставит второго двоеточия: приложения разбирают его по-разному', () => {
    const label = decodeURIComponent(new URL(otpauthUri(SUBJECT, SECRET)).pathname);

    expect(label.split(':')).toHaveLength(2);
  });
});
