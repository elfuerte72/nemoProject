import { describe, expect, it } from 'vitest';
import { add, compare, divide, format, multiply, percentOf, toAmount } from './money.js';

describe('Amount', () => {
  it('складывает суммы без потери точности на дробях, где ломается float', () => {
    expect(add(toAmount('0.1'), toAmount('0.2'))).toBe('0.3');
  });

  it('держит 18 знаков — масштаб эфира', () => {
    const oneWei = toAmount('0.000000000000000001');
    expect(add(oneWei, oneWei)).toBe('0.000000000000000002');
  });

  it('не теряет точность на суммах, переполняющих bigint в минорных единицах', () => {
    // 10 ETH в wei — это 10^19, за пределами 64-битного bigint Postgres.
    expect(multiply(toAmount('10'), toAmount('1000000000000000000'))).toBe(
      '10000000000000000000',
    );
  });

  it('отбрасывает лишние знаки вниз, а не округляет вверх', () => {
    expect(toAmount('0.9999999999999999999')).toBe('0.999999999999999999');
  });

  it('считает долю в базисных пунктах', () => {
    // Доход по заявке 100, реферальные 400 bps = 4%.
    expect(percentOf(toAmount('100'), 400)).toBe('4');
  });

  it('отвергает дробные и отрицательные базисные пункты', () => {
    expect(() => percentOf(toAmount('100'), 1.5)).toThrow(RangeError);
    expect(() => percentOf(toAmount('100'), -1)).toThrow(RangeError);
  });

  it('бросает при делении на ноль вместо возврата бесконечности', () => {
    expect(() => divide(toAmount('1'), toAmount('0'))).toThrow(RangeError);
  });

  it('сравнивает как числа, а не как строки', () => {
    // Лексикографически '9' > '10', численно наоборот.
    expect(compare(toAmount('9'), toAmount('10'))).toBeLessThan(0);
  });

  it('форматирует с фиксированным числом знаков без экспоненты', () => {
    expect(format(toAmount('0.000000000000000001'), 8)).toBe('0.00000000');
    expect(format(toAmount('1234.5'), 2)).toBe('1234.50');
  });

  it('бросает на нечисловом вводе', () => {
    expect(() => toAmount('не число')).toThrow();
  });
});
