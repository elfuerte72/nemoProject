import { payoutAfterFee, usdForPayout, type FeeTier } from './fee.js';
import * as Money from './money.js';
import type { Amount } from './money.js';

/**
 * Арифметика экрана обмена — одна на Mini App, кабинет мерчанта и API.
 *
 * Курс приходит с сервера, а суммы считает экран: от суммы курс не
 * зависит, и круг по сети ради умножения — это секунда на каждую
 * набранную цифру. Считает экран той же `Money`, что и ядро, и тем же
 * правилом — оно живёт здесь, а не в трёх копиях по приложениям:
 * разойдясь на знаке, копии пообещали бы одно, а заявка записала бы
 * другое.
 */

/**
 * Цена пути целиком — только там, где её назначает сетка комиссии.
 *
 * Отдаётся экрану, чтобы он считал сам, а не спрашивал сервер на
 * каждую набранную цифру: со ступенями курс зависит от суммы, и круг
 * по сети означал бы секунду ожидания на каждый символ.
 */
export interface QuoteFee {
  /** Сколько USDT за единицу отдаваемой валюты. */
  readonly toBaseRate: Amount;
  /** Сколько получаемой валюты за один USDT. */
  readonly fromBaseRate: Amount;
  readonly tiers: readonly FeeTier[];
  /**
   * Минимум направления в долларовом эквиваленте — если владелец его
   * задал. Экран говорит о нём до подачи, подача сверяет; глобальный
   * минимум сервиса действует поверх, а не вместо.
   */
  readonly minUsd: Amount | null;
  /**
   * Как читать порог ступени — включительно или нет. Едет к экрану
   * вместе со ступенями: считая по ним сам, он обязан читать границу
   * тем же знаком, что и ядро, иначе на ровно двух тысячах экран и
   * заявка разошлись бы на процент.
   */
  readonly thresholdInclusive: boolean;
}

/**
 * Котировка, как её читает экран: курс, знак валюты выдачи и, если
 * цену назначает сетка, путь целиком. Ядро отдаёт её же — с отметкой
 * времени и суммой поверх.
 */
export interface Quote {
  /** Курс с наценкой сервиса — тот, что видит клиент. */
  readonly rate: Amount;
  /**
   * Сколько знаков у валюты выдачи — тот же, каким округлило ядро.
   * Свой список точностей на клиенте разошёлся бы со справочником в
   * тот день, когда администратор заведёт новую валюту.
   */
  readonly payoutDecimals: number;
  readonly fee?: QuoteFee | undefined;
}

/**
 * До скольких знаков делится обратный счёт. Столько же показывает
 * экран: число, обрезанное при показе, перестало бы давать обещанное.
 */
export const REVERSE_DIGITS = 8;

/**
 * Сколько получат, отдав столько.
 *
 * Там, где цену назначает сетка комиссии, считается путь целиком:
 * сумма переводится в доллары, из них вычитается ставка своей ступени,
 * остаток идёт в валюту выдачи. Той же арифметикой, какой считает ядро,
 * — иначе экран пообещал бы одно, а заявка записала другое.
 *
 * Знак — тот же, каким округлило ядро: он приезжает с котировкой.
 */
export function payoutOf(give: Amount, quote: Quote): Amount {
  const decimals = quote.payoutDecimals;
  if (!quote.fee) return Money.roundTo(Money.multiply(give, quote.rate), decimals);
  const { toBaseRate, fromBaseRate, tiers, thresholdInclusive } = quote.fee;
  const usd = Money.multiply(give, toBaseRate);
  // Путь целиком, а не «остаток на курс»: фикс ступени бывает задан в
  // валюте выдачи и вычитается уже после умножения. Знак границы
  // ступени — тот же, каким её читает ядро.
  return Money.roundTo(payoutAfterFee(usd, fromBaseRate, tiers, { thresholdInclusive }), decimals);
}

/**
 * Сколько отдать, чтобы получить не меньше названного.
 *
 * Вопрос звучит не реже прямого: с ним приходят за суммой брони, счёта,
 * билета. Делится вверх и до того же знака, до какого сумма
 * показывается: отброшенный вниз хвост возвращается умножением на курс
 * как недостача, и просивший пятьдесят тысяч получил бы 49 999,99.
 *
 * Со ступенчатой комиссией обратный счёт перестаёт быть делением:
 * ставка берётся от всей суммы, и выдача на границах скачет. Правило —
 * наименьшая сумма, при которой получают не меньше, чем просили;
 * считает его та же `usdForPayout`, что и ядро.
 *
 * `null` — когда считать нечем: нулевой курс или испорченное звено пути.
 */
export function giveFor(target: Amount, quote: Quote, digits = REVERSE_DIGITS): Amount | null {
  if (quote.fee) {
    const { toBaseRate, fromBaseRate, tiers, thresholdInclusive } = quote.fee;
    if (Money.isZero(fromBaseRate) || Money.isZero(toBaseRate)) return null;
    const neededUsd = usdForPayout(target, fromBaseRate, tiers, { thresholdInclusive });
    return neededUsd === null ? null : Money.divideCeil(neededUsd, toBaseRate, digits);
  }
  if (Money.isZero(quote.rate)) return null;
  return Money.divideCeil(target, quote.rate, digits);
}

/**
 * Что стоит на черте между отданным и полученным.
 *
 * У направления без сетки курс один на любую сумму, и черта называет
 * его сразу. Со ступенчатой сеткой курс зависит от суммы: фикс в десять
 * евро на ста долларах — десятая часть, на пяти тысячах — две тысячных.
 * До 28 августа 2026 черта до набора суммы пустовала, а на сумме ниже
 * минимума показывала «0 EUR за 1 RUB»: выдача, съеденная минимумом,
 * клампится в ноль, и ноль попадал в курс. Читалось это как «курс —
 * ноль», а не как «сумма мала».
 *
 * Теперь черта не пустует и нуля не называет:
 *
 * - сумма не набрана — курс называется для наименьшей суммы, с которой
 *   сервис работает по этому направлению: минимума направления, а без
 *   него — общего минимума сервиса. Это не обещание на любую сумму, а
 *   ориентир, и он тем честнее, что с ростом суммы курс только лучше;
 * - сумма ниже минимума или съедена комиссией — вместо курса стоит
 *   «от N», в валюте, которую клиент отдаёт: порог из письма владельца
 *   назван в долларах, но набирает клиент рубли, и ответ «от 43 811 RUB»
 *   отвечает на его вопрос, а «500 $» — на вопрос владельца;
 * - иначе — курс от набранного: частное того, что получит, на то, что
 *   отдаёт, той же арифметикой, что и ядро.
 *
 * Правило вынесено из разметки, потому что глазом его не проверить:
 * ноль на черте появлялся только на одной комбинации суммы и сетки.
 */
export type RateLine =
  | { readonly kind: 'rate'; readonly rate: Amount }
  | { readonly kind: 'from'; readonly giveAtLeast: Amount }
  | { readonly kind: 'none' };

/**
 * `serviceMinUsd` — общий минимум сервиса; он задан в USDT, а USDT
 * считается долларом (docs/adr/0007), и на той же линейке лежит порог
 * сетки.
 */
export function rateLine(
  quote: Quote,
  give: Amount | null,
  serviceMinUsd: Amount | null,
): RateLine {
  if (!quote.fee) {
    // Испорченная котировка — не курс: «0 RUB за 1 USDT» читалось бы
    // как «не дадут ничего», а не как «курса нет».
    if (Money.isZero(quote.rate) || Money.isNegative(quote.rate)) return { kind: 'none' };
    return { kind: 'rate', rate: quote.rate };
  }

  const { toBaseRate, minUsd } = quote.fee;
  // Нулевым звеном ни делить, ни мерить; испорченная котировка — не курс.
  if (Money.isZero(toBaseRate) || Money.isNegative(toBaseRate)) return { kind: 'none' };
  const reference = minUsd ?? serviceMinUsd;

  const typed = give !== null && !Money.isZero(give) && !Money.isNegative(give);
  if (typed) {
    const usd = Money.multiply(give, toBaseRate);
    const payout = payoutOf(give, quote);
    const belowMinimum = minUsd !== null && Money.compare(usd, minUsd) < 0;
    if (!belowMinimum && !Money.isZero(payout)) {
      return { kind: 'rate', rate: Money.divide(payout, give) };
    }
    if (reference === null) return { kind: 'none' };
    // До целого вверх: «от 43 810,9 RUB» точнее, но читается хуже, а
    // округление вниз назвало бы сумму, которой ещё мало.
    return { kind: 'from', giveAtLeast: Money.ceil(Money.divide(reference, toBaseRate)) };
  }

  if (reference === null) return { kind: 'none' };
  const { fromBaseRate, tiers, thresholdInclusive } = quote.fee;
  const giveAtReference = Money.divide(reference, toBaseRate);
  // От долларового ориентира, а не от частного обратно в доллары: ровно
  // на пороге ступени хвост деления сдвинул бы сумму на другую ставку.
  const payout = Money.roundTo(
    payoutAfterFee(reference, fromBaseRate, tiers, { thresholdInclusive }),
    quote.payoutDecimals,
  );
  if (Money.isZero(payout) || Money.isZero(giveAtReference)) return { kind: 'none' };
  return { kind: 'rate', rate: Money.divide(payout, giveAtReference) };
}

/** Обе стороны сделки — как их считает экран: та, в которую вводят, и посчитанная. */
export interface Sides {
  readonly give: Amount | null;
  readonly get: Amount | null;
}

/**
 * Чем меряется минимальная сумма обмена — одним правилом на ядро и оба
 * экрана: экран не должен дать подать заявку, которую подача отвергнет,
 * и меряет её тем же числом.
 *
 * Порог задан в USDT. Там, где цену назначает сетка, долларовый
 * эквивалент уже посчитан ради выбора ступени — им и меряют: у пары
 * «рубли — баты» этой валюты нет ни с одной стороны. Иначе — сторона,
 * выраженная в валюте порога: отданная или полученная. Без того и
 * другого порог не меряется вовсе: отказ по числу, которого у сервиса
 * в этот момент нет, выглядел бы поломкой.
 */
export function minimumMeasure(input: {
  readonly thresholdCode: string;
  readonly fromCode: string;
  readonly toCode: string;
  readonly give: Amount | null;
  readonly get: Amount | null;
  readonly usdAmount: Amount | null;
}): Amount | null {
  if (input.usdAmount !== null) return input.usdAmount;
  if (input.fromCode === input.thresholdCode) return input.give;
  if (input.toCode === input.thresholdCode) return input.get;
  return null;
}

/** Есть ли куда отправить: запись выбрана, не выбрана, у валюты родов нет. */
export type RecipientState = 'chosen' | 'missing' | 'unsupported';

export interface ObstacleInput {
  readonly terms: { readonly minAmount: Amount; readonly minAmountCode: string };
  readonly fromCode: string;
  readonly toCode: string;
  readonly sides: Sides;
  /** `undefined` — ответ о курсе ещё не пришёл; `null` — курса нет. */
  readonly quote: Quote | null | undefined;
  readonly recipient: RecipientState;
}

/**
 * Что мешает подать заявку — то самое, из-за чего не горит кнопка.
 *
 * Только названное словами: пустое поле и не пришедший ещё курс сюда
 * не идут — первое человек видит сам, второе живёт полвздоха. Слова
 * одни на Mini App и кабинет: отказывает всё равно операция, а экран
 * лишь не даёт подать заявку, про которую уже известно, что её
 * отвергнут. Сумму словами показывает тот, кто зовёт: разряды и знаки у
 * каждого приложения свои.
 *
 * Порог направления — в долларах, как его и задал владелец: это число
 * из его письма, и переводить его в валюту отдачи значило бы называть
 * порог, которого владелец не называл.
 */
export function submissionObstacle(
  input: ObstacleInput,
  money: (value: Amount, code: string) => string,
): string | undefined {
  const { terms, fromCode, toCode, sides, quote, recipient } = input;

  const usdAmount =
    quote?.fee && sides.give ? Money.multiply(sides.give, quote.fee.toBaseRate) : null;
  const measured = minimumMeasure({
    thresholdCode: terms.minAmountCode,
    fromCode,
    toCode,
    give: sides.give,
    get: sides.get,
    usdAmount,
  });
  if (measured && Money.compare(measured, terms.minAmount) < 0) {
    return `Меньше минимальной суммы обмена — ${money(terms.minAmount, terms.minAmountCode)}.`;
  }

  const directionMin = quote?.fee?.minUsd ?? null;
  if (directionMin && usdAmount && Money.compare(usdAmount, directionMin) < 0) {
    return `Меньше минимальной суммы направления — ${money(directionMin, '$')}.`;
  }

  // Выдача, съеденная комиссией целиком: подавать «0 по курсу 0» ядро
  // всё равно откажется, но узнать об этом надо до нажатия.
  if (quote && sides.give && Money.isZero(payoutOf(sides.give, quote))) {
    return 'Сумма слишком мала: после комиссии к выдаче ничего не останется.';
  }

  if (recipient === 'unsupported') {
    return `Получение ${toCode} переводом пока в разработке: реквизиты для этой валюты сервис ещё не принимает.`;
  }
  if (recipient === 'missing') {
    return 'Укажите получателя: без реквизитов деньги некуда отправить.';
  }
  return undefined;
}
