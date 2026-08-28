import type { QuoteView } from '@nemo/core';
import { Money, payoutAfterFee, type Amount } from '@nemo/types';

/**
 * Что стоит на черте между отданным и полученным.
 *
 * У направления без сетки курс один на любую сумму, и черта называет
 * его сразу. Со ступенчатой сеткой курс зависит от суммы: фикс в десять
 * евро на ста долларах — десятая часть, на пяти тысячах — две тысячных.
 * До этой правки черта до набора суммы пустовала, а на сумме ниже
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
  quote: QuoteView,
  give: Amount | null,
  serviceMinUsd: Amount | null,
): RateLine {
  if (!quote.fee) return { kind: 'rate', rate: quote.rate };

  const { toBaseRate, fromBaseRate, tiers, minUsd } = quote.fee;
  // Нулевым звеном ни делить, ни мерить; испорченная котировка — не курс.
  if (Money.isZero(toBaseRate) || Money.isNegative(toBaseRate)) return { kind: 'none' };
  const reference = minUsd ?? serviceMinUsd;

  const typed = give !== null && !Money.isZero(give) && !Money.isNegative(give);
  if (typed) {
    const usd = Money.multiply(give, toBaseRate);
    const payout = Money.roundTo(payoutAfterFee(usd, fromBaseRate, tiers), quote.payoutDecimals);
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
  const giveAtReference = Money.divide(reference, toBaseRate);
  const payout = Money.roundTo(
    payoutAfterFee(reference, fromBaseRate, tiers),
    quote.payoutDecimals,
  );
  if (Money.isZero(payout)) return { kind: 'none' };
  return { kind: 'rate', rate: Money.divide(payout, giveAtReference) };
}
