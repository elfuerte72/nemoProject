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

/**
 * Деление с округлением вверх до заданного знака.
 *
 * Нужно обратному счёту: клиент называет сумму, которую хочет получить,
 * а заявка подаётся отданной — и её приходится искать делением. Обычное
 * деление отбрасывает хвост вниз, и обратное умножение возвращает на
 * единицу меньше названного: 50 000 / 81, умноженное на 81, даёт
 * 49 999,999…, а сумма к выдаче считается вниз до целого — то есть
 * 49 999. Клиент просил пятьдесят тысяч и увидел бы на рубль меньше.
 *
 * Знак задаётся вызывающим, потому что число это показывают человеку:
 * восемнадцать знаков в поле ввода нечитаемы, а округлив их до восьми
 * вниз, мы вернули бы ту же недостачу.
 */
export function divideCeil(a: Amount, b: Amount, decimals = SCALE): Amount {
  if (new Decimal(b).isZero()) {
    throw new RangeError('Деление на ноль');
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > SCALE) {
    throw new RangeError(`Знаков после запятой должно быть от 0 до ${SCALE}: ${decimals}`);
  }
  /*
   * Отрицательные не принимаются вовсе.
   *
   * «Вверх» у них имеет два прочтения — прочь от нуля и к большему
   * числу, — и они дают разный ответ. Спор этот здесь решать нечем:
   * обратный счёт идёт от суммы, которую клиент хочет получить, а
   * отрицательных сумм не бывает. Отказ честнее молчаливого выбора
   * одного из двух смыслов.
   */
  if (new Decimal(a).isNegative() || new Decimal(b).isNegative()) {
    throw new RangeError('Обратный счёт идёт от неотрицательных величин');
  }
  return new Decimal(a)
    .dividedBy(b)
    .toDecimalPlaces(decimals, Decimal.ROUND_UP)
    .toFixed() as Amount;
}

/**
 * Округление до целого — вниз и вверх.
 *
 * Нужны курсу: он называется клиенту целым числом, и целым же считается,
 * иначе показанное на экране не сойдётся с посчитанным. Направление
 * выбирает тот, кто округляет: у обмена оно зависит от того, кто по
 * этой сделке платит, и «к ближайшему» здесь означало бы отдавать часть
 * наценки случаю.
 */
export function floor(value: Amount): Amount {
  return toAmount(new Decimal(value).floor());
}

export function ceil(value: Amount): Amount {
  return toAmount(new Decimal(value).ceil());
}

/**
 * Округление к ближайшему целому.
 *
 * Нужно там, где целое уже получено, но прошло через деление: курс
 * мельче единицы хранится как «единица, делённая на целое», и обратное
 * деление возвращает не 82, а 81,999999999999998 — хвост, оставшийся от
 * ограниченной точности. Показывать такое нельзя, а отбрасывать вниз
 * тем более: получилось бы 81.
 */
export function round(value: Amount): Amount {
  return toAmount(new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
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
