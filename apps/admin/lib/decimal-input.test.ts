import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import { decimalFromInput } from './decimal-input';

/**
 * Дробное число из поля панели — в том виде, в каком его примет ядро.
 *
 * Экранная клавиатура iPhone с русской раскладкой в поле `decimal` даёт
 * запятую, а схема денег ядра знает только точку. До 17 сентября 2026
 * карточка заявки отправляла курс и доход как набрано, и дробный доход с
 * телефона не вводился вовсе.
 */

function accepted(typed: string): boolean {
  return Money.amountSchema.safeParse(decimalFromInput(typed)).success;
}

describe('дробное число из поля ввода', () => {
  it('набранное с запятой ядро принимает', () => {
    expect(Money.amountSchema.safeParse('32,67').success).toBe(false);
    expect(accepted('32,67')).toBe(true);
    expect(decimalFromInput('165,30')).toBe('165.30');
  });

  it('с точкой и целое не меняются, пробелы по краям уходят', () => {
    expect(decimalFromInput('12.5')).toBe('12.5');
    expect(decimalFromInput(' 500 ')).toBe('500');
  });

  it('не число числом не становится: отказ ядра, а не другая сумма', () => {
    expect(accepted('2,5,5')).toBe(false);
    expect(accepted('1 000,50')).toBe(false);
    expect(accepted('')).toBe(false);
  });
});
