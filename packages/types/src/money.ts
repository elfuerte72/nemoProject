import Decimal from 'decimal.js';
import { z } from 'zod';

/**
 * Денежная сумма или курс: десятичное число произвольной точности,
 * представленное строкой.
 *
 * Строка, а не `number`, потому что сервис работает с криптовалютами:
 * у эфира 18 знаков после запятой, 1 ETH = 10^18 wei, а безопасный
 * целочисленный диапазон JavaScript обрывается на ~9 * 10^15. Хранение
 * в минорных единицах целым числом переполняется на девяти эфирах,
 * `number` теряет точность ещё раньше.
 *
 * В базе этому типу соответствует `numeric(38, 18)`.
 */
export type Amount = string & { readonly __brand: 'Amount' };

/** Максимум знаков после запятой — совпадает с масштабом колонки в базе. */
const SCALE = 18;

Decimal.set({ precision: 40, toExpNeg: -SCALE - 1, toExpPos: 40 });

const AMOUNT_PATTERN = new RegExp(`^-?\\d{1,20}(\\.\\d{1,${SCALE}})?$`);

export const amountSchema = z
  .string()
  .regex(AMOUNT_PATTERN, 'Ожидается десятичное число, не более 18 знаков после запятой')
  .transform((value) => value as Amount);

export const positiveAmountSchema = amountSchema.refine(
  (value) => new Decimal(value).greaterThan(0),
  'Сумма должна быть больше нуля',
);

export const ZERO = '0' as Amount;

/**
 * Приводит произвольный ввод к `Amount`, отбрасывая лишние знаки вниз.
 * Бросает, если строка вообще не является числом.
 */
export function toAmount(value: string | number | Decimal): Amount {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) {
    throw new TypeError(`Не число: ${String(value)}`);
  }
  return decimal.toDecimalPlaces(SCALE, Decimal.ROUND_DOWN).toFixed() as Amount;
}

export function add(a: Amount, b: Amount): Amount {
  return toAmount(new Decimal(a).plus(b));
}

export function subtract(a: Amount, b: Amount): Amount {
  return toAmount(new Decimal(a).minus(b));
}

export function multiply(a: Amount, b: Amount): Amount {
  return toAmount(new Decimal(a).times(b));
}

export function divide(a: Amount, b: Amount): Amount {
  if (new Decimal(b).isZero()) {
    throw new RangeError('Деление на ноль');
  }
  return toAmount(new Decimal(a).dividedBy(b));
}

/** Доля от суммы в базисных пунктах: 100 bps = 1%. */
export function percentOf(amount: Amount, basisPoints: number): Amount {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError(`Базисные пункты должны быть целыми и неотрицательными: ${basisPoints}`);
  }
  return toAmount(new Decimal(amount).times(basisPoints).dividedBy(10_000));
}

/** Отрицательное при a < b, ноль при равенстве, положительное при a > b. */
export function compare(a: Amount, b: Amount): number {
  return new Decimal(a).comparedTo(b);
}

export function isZero(value: Amount): boolean {
  return new Decimal(value).isZero();
}

export function isNegative(value: Amount): boolean {
  return new Decimal(value).isNegative();
}

/** Строка для показа человеку: фиксированное число знаков, без экспоненты. */
export function format(value: Amount, decimals: number): string {
  return new Decimal(value).toFixed(decimals, Decimal.ROUND_DOWN);
}
