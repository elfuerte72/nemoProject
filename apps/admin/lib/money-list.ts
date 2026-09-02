import { Money, type Amount } from '@nemo/types';
import { formatAmount } from './format';

/**
 * Деньги по валютам — строкой, без суммирования между собой.
 *
 * «12 300 RUB · 450 USDT»: исторического курса у сервиса нет, и одно
 * число вместо двух читалось бы как факт, которого нет. Пусто — «—»:
 * ноль здесь значил бы «ноль рублей», а не «оборота не было».
 */
export interface MoneyLine {
  readonly code: string;
  readonly amount: Amount;
  readonly count?: number | undefined;
}

export function formatByCurrency(lines: readonly MoneyLine[]): string {
  if (lines.length === 0) return '—';
  return lines.map((line) => `${formatAmount(line.amount)} ${line.code}`).join(' · ');
}

/** Средний чек по каждой валюте: сумма на число заявок в ней. */
export function averageByCurrency(lines: readonly MoneyLine[]): MoneyLine[] {
  return lines
    .filter((line) => (line.count ?? 0) > 0)
    .map((line) => ({
      code: line.code,
      amount: Money.roundTo(Money.divide(line.amount, Money.toAmount(String(line.count))), 2),
    }));
}

/**
 * Сравнение с прошлым периодом по одной валюте: «было 10 200 RUB» и
 * знак. Валюты сравниваются только с собой: рубли с рублями.
 */
export function compareByCurrency(
  now: readonly MoneyLine[],
  before: readonly MoneyLine[],
): readonly { code: string; delta: 'up' | 'down' | 'flat'; before: Amount }[] {
  return now.map((line) => {
    const previous = before.find((one) => one.code === line.code);
    const was = previous?.amount ?? Money.ZERO;
    const sign = Money.compare(line.amount, was);
    return { code: line.code, delta: sign > 0 ? 'up' : sign < 0 ? 'down' : 'flat', before: was };
  });
}
