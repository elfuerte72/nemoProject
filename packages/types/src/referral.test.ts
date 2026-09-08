import { describe, expect, it } from 'vitest';
import {
  MAX_REFERRAL_DEPTH,
  normalizeReferralCode,
  promoCodeSchema,
  referralLineName,
  referralLineWord,
  referralLines,
} from './referral.js';

/**
 * Правила реферальной программы, которые делят ядро и экраны.
 *
 * Промокод проверяется до отправки тем же правилом, каким его отвергает
 * операция: два правила, разойдясь в одном знаке, дали бы код, который
 * форма приняла, а ядро нет.
 */
describe('линии', () => {
  it('их пять, и слово есть у каждой', () => {
    expect(referralLines).toEqual([1, 2, 3, 4, 5]);
    expect(MAX_REFERRAL_DEPTH).toBe(5);
    expect(referralLines.map(referralLineWord)).toEqual([
      'первой',
      'второй',
      'третьей',
      'четвёртой',
      'пятой',
    ]);
    expect(referralLines.map(referralLineName)).toEqual([
      'первая',
      'вторая',
      'третья',
      'четвёртая',
      'пятая',
    ]);
  });
});

describe('промокод', () => {
  it('принимает слово от четырёх до шестнадцати знаков и приводит к верхнему регистру', () => {
    expect(promoCodeSchema.parse(' summer2026 ')).toBe('SUMMER2026');
    expect(promoCodeSchema.parse('abcd')).toBe('ABCD');
    expect(promoCodeSchema.parse('A'.repeat(16))).toBe('A'.repeat(16));
  });

  it('отвергает короткое, длинное и не латиницу словами', () => {
    expect(promoCodeSchema.safeParse('abc').success).toBe(false);
    expect(promoCodeSchema.safeParse('A'.repeat(17)).success).toBe(false);
    const cyrillic = promoCodeSchema.safeParse('лето2026');
    expect(cyrillic.success).toBe(false);
    if (!cyrillic.success) {
      expect(cyrillic.error.issues[0]?.message).toMatch(/латиниц/i);
    }
    expect(promoCodeSchema.safeParse('sum mer').success).toBe(false);
  });

  it('не отдаёт слова сервиса', () => {
    for (const word of ['tobee', 'ADMIN', 'Support', 'nemo']) {
      const result = promoCodeSchema.safeParse(word);
      expect(result.success, word).toBe(false);
    }
    // Слово сервиса внутри другого — законно: «tobeefan» ничьё.
    expect(promoCodeSchema.safeParse('tobeefan').success).toBe(true);
  });
});

describe('поиск по коду', () => {
  it('сравнивает без учёта регистра и пробелов по краям', () => {
    expect(normalizeReferralCode('  aBc7XyZ9Q ')).toBe('ABC7XYZ9Q');
  });
});
