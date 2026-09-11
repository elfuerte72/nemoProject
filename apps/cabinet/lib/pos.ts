import { Money, giveFor, payoutOf, type Amount, type Quote } from '@nemo/types';
import type { MockInvoice } from './invoice-rows';

/**
 * Касса: что покупатель выбирает и сколько за это платит.
 *
 * Курс берётся тем же путём, что на экране новой заявки, и считается
 * той же арифметикой (`payoutOf`, `giveFor` из `@nemo/types`): двух
 * правд о цене быть не должно — покупатель у стойки и мерчант в
 * кабинете смотрят на одно число.
 *
 * Денег за этим экраном нет: счёт — запись макета, оплату он нигде не
 * обещает. Чем платит покупатель мерчанта и через кого приходят деньги,
 * владелец ещё не назвал (`backlog.md`).
 */

export type PosSide = 'buy' | 'pay';

/**
 * Сколько покупатель заплатит — вверх до целой единицы валюты оплаты.
 *
 * Вверх, а не к ближайшему: у образца так, и владелец описывал это
 * словами «плюс один-два рубля». Копейки у стойки не отдают, а
 * округление вниз стоило бы мерчанту той же копейки на каждой продаже.
 */
export function buyerPays(amount: Amount): Amount {
  return Money.ceil(amount);
}

export interface PosSides {
  /** Сколько покупатель получит в своей валюте. */
  readonly buy: Amount | null;
  /** Сколько он за это заплатит — целыми единицами валюты оплаты. */
  readonly pay: Amount | null;
}

/**
 * Обе стороны продажи. Считается та, в которую не вводят: «дай батов
 * на пять тысяч рублей» и «нужно ровно 2 000 батов» — два вопроса
 * одной кассы, и оба задают у стойки.
 *
 * Счёт к оплате всегда округляется вверх — и когда его посчитали, и
 * когда его набрали руками: набранные «5 000,40 ₽» это та же копейка
 * у стойки.
 */
export function posSides(value: Amount | null, side: PosSide, quote: Quote | null): PosSides {
  if (value === null) return { buy: null, pay: null };
  if (side === 'pay') {
    const pay = buyerPays(value);
    // Выдача, съеденная комиссией целиком, — не сделка: арифметика
    // клампит отрицательное в ноль, и без этого счёт уходил бы на «0 THB
    // по курсу 0». Теми же словами это отвергает подача заявки в ядре.
    const buy = quote ? payoutOf(pay, quote) : null;
    return { buy: buy !== null && Money.isZero(buy) ? null : buy, pay };
  }
  // Сколько нужно отдать, чтобы вышло ровно столько, — вверх, как у
  // обратного счёта заявки: отброшенный хвост вернулся бы недостачей.
  // Обратный счёт по сетке иногда не сходится вовсе — тогда счёта нет,
  // а не «ноль рублей».
  const back = quote ? giveFor(value, quote) : null;
  return { buy: value, pay: back === null ? null : buyerPays(back) };
}

export interface NewInvoiceInput {
  readonly number: string;
  readonly purpose: string;
  readonly buyer: string;
  readonly author: string;
  readonly code: string;
  readonly amount: Amount;
  readonly payCode: string;
  readonly payAmount: Amount;
  readonly rate: Amount;
  readonly at: Date;
}

/** Счёт-макет со своей лентой: первая строка в ней — как он появился. */
export function makeInvoice(input: NewInvoiceInput): MockInvoice {
  const at = input.at.toISOString();
  return {
    id: `inv_${input.at.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    number: input.number,
    purpose: input.purpose,
    buyer: input.buyer,
    author: input.author,
    code: input.code,
    amount: input.amount,
    payCode: input.payCode,
    payAmount: input.payAmount,
    rate: input.rate,
    status: 'issued',
    createdAt: at,
    paidAt: null,
    events: [{ at, what: `Счёт выставлен: ${input.author}` }],
  };
}

/**
 * Номер счёта: день и порядковый за него. Номер называют покупателю
 * вслух, и идентификатор из тридцати знаков для этого не годится.
 *
 * День — местный, а не по UTC: счётчик за смену считается по местной
 * полуночи, и в два часа ночи в Бангкоке «за смену: 3» стояло бы рядом
 * со счётом, названным вчерашним числом.
 */
export function nextNumber(
  existing: readonly MockInvoice[],
  at: Date,
  offsetMinutes = 0,
): string {
  const day = localDay(at, offsetMinutes);
  const today = existing.filter((one) => one.number.startsWith(day)).length;
  return `${day}-${String(today + 1).padStart(3, '0')}`;
}

/** День «2026-09-12» по местному времени того, кто у кассы. */
export function localDay(at: Date, offsetMinutes: number): string {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}
