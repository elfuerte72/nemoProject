import { describe, expect, it } from 'vitest';
import { dayWords, salute } from './greeting';

describe('приветствие по часу', () => {
  it('называет время суток', () => {
    expect(salute(3)).toBe('Доброй ночи');
    expect(salute(5)).toBe('Доброе утро');
    expect(salute(11)).toBe('Доброе утро');
    expect(salute(12)).toBe('Добрый день');
    expect(salute(17)).toBe('Добрый день');
    expect(salute(18)).toBe('Добрый вечер');
    expect(salute(23)).toBe('Добрый вечер');
  });

  it('дата словами начинается с большой буквы', () => {
    expect(dayWords(new Date(2026, 8, 2, 12))).toBe('Среда, 2 сентября');
  });
});
