import { Money, giveFor, payoutOf, rateLine, type Amount, type Quote, type RateLine } from '@nemo/types';
import type { MockInvoice } from './invoice-rows';

/**
 * POS-терминал: что покупатель выбирает и сколько за это платит.
 *
 * Курс берётся тем же путём, что на экране новой заявки, и считается
 * той же арифметикой (`payoutOf`, `giveFor` из `@nemo/types`): двух
 * правд о цене быть не должно — покупатель у стойки и мерчант в
 * кабинете смотрят на одно число.
 *
 * Поверх курса сервиса стоит наценка мерчанта (`pos/settings.ts`): его
 * доход с продажи у стойки. Применяется она к стороне оплаты и одним
 * множителем в обе стороны счёта, чтобы «дай батов на пять тысяч» и
 * «нужно ровно две тысячи батов» сходились друг с другом.
 *
 * Денег за этим экраном нет: платёж принимает имитация
 * (`pos/acquirer.ts`), и на экране это сказано словами.
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

/** Множитель наценки: 250 базисных пунктов — «1,025». */
export function markupFactor(markupBps: number): Amount {
  if (!Number.isInteger(markupBps) || markupBps < 0) {
    throw new RangeError(`Наценка — целые неотрицательные базисные пункты: ${markupBps}`);
  }
  return Money.divide(Money.toAmount(10_000 + markupBps), Money.toAmount(10_000));
}

/** Курс «валюта за 1 RUB» с наценкой мерчанта: за тот же рубль дают меньше. */
export function markupRate(rate: Amount, markupBps: number): Amount {
  return markupBps === 0 ? rate : Money.divide(rate, markupFactor(markupBps));
}

/** Сумма, которую видит сервис, из суммы, которую платит покупатель. */
function beforeMarkup(pay: Amount, markupBps: number): Amount {
  return markupBps === 0 ? pay : Money.divide(pay, markupFactor(markupBps));
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
 * одного терминала, и оба задают у стойки.
 *
 * Счёт к оплате всегда округляется вверх — и когда его посчитали, и
 * когда его набрали руками: набранные «5 000,40 ₽» это та же копейка
 * у стойки.
 */
export function posSides(
  value: Amount | null,
  side: PosSide,
  quote: Quote | null,
  markupBps = 0,
): PosSides {
  if (value === null) return { buy: null, pay: null };
  if (side === 'pay') {
    const pay = buyerPays(value);
    // Выдача, съеденная комиссией целиком, — не сделка: арифметика
    // клампит отрицательное в ноль, и без этого счёт уходил бы на «0 THB
    // по курсу 0». Теми же словами это отвергает подача заявки в ядре.
    const buy = quote ? payoutOf(beforeMarkup(pay, markupBps), quote) : null;
    return { buy: buy !== null && Money.isZero(buy) ? null : buy, pay };
  }
  // Сколько нужно отдать, чтобы вышло ровно столько, — вверх, как у
  // обратного счёта заявки: отброшенный хвост вернулся бы недостачей.
  // Обратный счёт по сетке иногда не сходится вовсе — тогда счёта нет,
  // а не «ноль рублей».
  const back = quote ? giveFor(value, quote) : null;
  return {
    buy: value,
    pay: back === null ? null : buyerPays(Money.multiply(back, markupFactor(markupBps))),
  };
}

/**
 * Что стоит на черте курса — тем же `rateLine`, что у формы заявки, но с
 * наценкой мерчанта поверх: без неё черта называла бы курс, по которому
 * счёт не сходится с суммой над ней.
 */
export function posRateLine(
  quote: Quote,
  pay: Amount | null,
  serviceMinUsd: Amount,
  markupBps = 0,
): RateLine {
  const line = rateLine(quote, pay === null ? null : beforeMarkup(pay, markupBps), serviceMinUsd);
  if (markupBps === 0) return line;
  if (line.kind === 'rate') return { ...line, rate: markupRate(line.rate, markupBps) };
  if (line.kind === 'from') {
    return {
      ...line,
      giveAtLeast: buyerPays(Money.multiply(line.giveAtLeast, markupFactor(markupBps))),
    };
  }
  return line;
}

/**
 * Сумма, на которой объяснение терминала показывает путь денег, пока
 * своя не набрана: пять тысяч рублей — столько у стойки просят чаще
 * всего. Считается по ней всё по-настоящему, и подпись зовёт её
 * примером. Набранная своя сумма выигрывает всегда.
 */
export function examplePay(): Amount {
  return Money.toAmount('5000');
}

export interface NewInvoiceInput {
  readonly number: string;
  readonly author: string;
  readonly code: string;
  readonly amount: Amount;
  readonly payCode: string;
  readonly payAmount: Amount;
  readonly rate: Amount;
  readonly markupBps: number;
  readonly kycRequired: boolean;
  readonly at: Date;
  /** Пусто — счёт без срока: так заводились счета до провайдера. */
  readonly expiresAt: Date | null;
  readonly demo?: boolean | undefined;
}

/** Счёт-макет со своей лентой: первая строка в ней — как он появился. */
export function makeInvoice(input: NewInvoiceInput): MockInvoice {
  const at = input.at.toISOString();
  return {
    id: `inv_${input.at.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    number: input.number,
    author: input.author,
    code: input.code,
    amount: input.amount,
    payCode: input.payCode,
    payAmount: input.payAmount,
    rate: input.rate,
    markupBps: input.markupBps,
    status: 'issued',
    createdAt: at,
    expiresAt: input.expiresAt === null ? null : input.expiresAt.toISOString(),
    paidAt: null,
    kycRequired: input.kycRequired,
    kycPassedAt: null,
    payment: null,
    demo: input.demo ?? false,
    events: [{ at, what: `Счёт создан: ${input.author}` }],
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

/** День «2026-09-12» по местному времени того, кто у терминала. */
export function localDay(at: Date, offsetMinutes: number): string {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}
