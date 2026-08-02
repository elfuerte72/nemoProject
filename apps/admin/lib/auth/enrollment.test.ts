import { describe, expect, it } from 'vitest';
import { enrollmentQr } from './enrollment.js';

describe('код для камеры', () => {
  it('имеет собственный размер', async () => {
    // Без ширины у разметки остаётся один viewBox, и в контейнере,
    // подстраивающемся под содержимое, картинка схлопывается в ноль:
    // рамка на месте, кода не видно. Ровно это и случилось на боевом.
    const svg = await enrollmentQr('otpauth://totp/nemo:483902117%20%C2%B7%20admin?secret=X54LSROYJZIBIDXYRXRMOTSCZF2JGNSH');

    expect(svg).toMatch(/width="\d+"/);
    expect(svg).toMatch(/height="\d+"/);
  });
});
