import { describe, expect, it } from 'vitest';
import { enrollmentQr, otpauthUri } from './enrollment.js';

const SECRET = 'X54LSROYJZIBIDXYRXRMOTSCZF2JGNSH';

describe('ссылка для аутентификатора', () => {
  it('собрана по стандарту otpauth', () => {
    const uri = new URL(otpauthUri('Анна', SECRET));

    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(SECRET);
    expect(uri.searchParams.get('period')).toBe('30');
    expect(uri.searchParams.get('digits')).toBe('6');
  });

  it('несёт имя сотрудника: в приложении со списком служб иначе не разобрать', () => {
    expect(decodeURIComponent(otpauthUri('Анна', SECRET))).toContain('nemoProject:Анна');
  });
});

describe('код для камеры', () => {
  it('имеет собственный размер', async () => {
    // Без ширины у разметки остаётся один viewBox, и в контейнере,
    // подстраивающемся под содержимое, картинка схлопывается в ноль:
    // рамка на месте, кода не видно. Ровно это и случилось на боевом.
    const svg = await enrollmentQr('Анна', SECRET);

    expect(svg).toMatch(/width="\d+"/);
    expect(svg).toMatch(/height="\d+"/);
  });
});
