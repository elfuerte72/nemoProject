import { describe, expect, it } from 'vitest';
import { bpsToPercent, percentToBps } from './percent';

describe('ставка в процентах', () => {
  it('показывает базисные пункты процентами: администратор читает проценты', () => {
    expect(bpsToPercent(200)).toBe('2');
    expect(bpsToPercent(50)).toBe('0.5');
    expect(bpsToPercent(1)).toBe('0.01');
  });

  it('переводит введённое обратно в пункты', () => {
    expect(percentToBps('2')).toBe(200);
    expect(percentToBps('0,5')).toBe(50);
    expect(percentToBps('12.34')).toBe(1234);
  });

  it('округляет до сотой процента: мельче ядро не хранит', () => {
    expect(percentToBps('0.005')).toBe(1);
  });

  it('отказывается от того, что не число: в ядро уходит ставка, а не опечатка', () => {
    expect(percentToBps('2,5,5')).toBeNull();
    expect(percentToBps('')).toBeNull();
    expect(percentToBps('−1')).toBeNull();
  });
});
