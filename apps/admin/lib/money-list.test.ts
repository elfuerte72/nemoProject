import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import { formatAmount } from './format';
import { averageByCurrency, compareByCurrency, formatByCurrency } from './money-list';

const line = (code: string, amount: string, count?: number) => ({
  code,
  amount: Money.toAmount(amount),
  count,
});

describe('деньги по валютам', () => {
  it('валюты стоят рядом и не складываются', () => {
    // Разряды и запятая — правило `formatAmount`; здесь проверяется склейка.
    expect(formatByCurrency([line('RUB', '12300'), line('USDT', '450.5')])).toBe(
      `${formatAmount('12300')} RUB · ${formatAmount('450.5')} USDT`,
    );
  });

  it('пусто — прочерк, а не ноль', () => {
    expect(formatByCurrency([])).toBe('—');
  });

  it('средний чек — на число заявок своей валюты, до сотых', () => {
    expect(averageByCurrency([line('RUB', '1000', 3), line('USDT', '0', 0)])).toEqual([
      { code: 'RUB', amount: '333.33' },
    ]);
  });

  it('сравнение — рубли с рублями, новой валюте не с чем', () => {
    expect(compareByCurrency([line('RUB', '200'), line('THB', '5')], [line('RUB', '300')])).toEqual([
      { code: 'RUB', delta: 'down', before: '300' },
      { code: 'THB', delta: 'up', before: '0' },
    ]);
  });
});
