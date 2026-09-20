import { Money } from '@nemo/types';

/**
 * Сколько сервис заработал на заявке — подсказкой, а не за менеджера.
 *
 * Число это обязательное, поправить его потом нельзя — от него считаются
 * реферальные начисления, — и до сих пор менеджер считал его в уме.
 * Считает панель, а не операция: подтверждать доход должен человек, и
 * молча подставленное число подтверждением не является.
 *
 * Откуда берётся: наценка вычитается из котировки при подаче
 * (`applyMarkup` в `packages/core/src/rates.ts`), то есть курс, который
 * увидел клиент, — это рынок минус наценка. Сервис получил от клиента
 * всё, а отдал за вычетом наценки; разница и есть доход.
 *
 * Считается он по-разному с двух сторон сделки, и это не придирка.
 * В отданной клиентом валюте наценка берётся прямо: из тысячи монет
 * сервис отдал рублями цену девятисот восьмидесяти, значит заработал
 * двадцать монет. В полученной — от остатка: восемь тысяч сто рублей и
 * есть те девяносто восемь процентов, и наценка сверх них не два
 * процента от них, а два от целого. Одна формула на обе стороны
 * завышала бы одну из них ровно на саму наценку.
 *
 * Наличные и ручной курс подсказка не покрывает: там сервис покупает не
 * по котировке, и наценки в курсе нет. Менеджер называет доход сам.
 */

/**
 * Знаков в подсказке. Копейки в рублёвом доходе — шум: его называют
 * рублями. Но у криптовалютной стороны две копейки бывают всем доходом,
 * и там знаки остаются.
 */
const COARSE_DIGITS = 2;
const FINE_DIGITS = 8;

const BPS_IN_WHOLE = 10_000;

export function suggestServiceIncome({
  amount,
  markupBps,
  side,
}: {
  /** Сторона сделки в той валюте, в которой называется доход. */
  amount: string | null;
  markupBps: number;
  /** Отданная клиентом сторона или полученная им. */
  side: 'given' | 'received';
}): string | null {
  if (amount === null) return null;
  if (markupBps === 0) return '0';
  // Наценка во все сто процентов означала бы курс, по которому клиент
  // не получает ничего: делить на остаток нечем. Такое приходит из
  // опечатки в настройках, и подсказка молчит, а не бросает.
  if (markupBps < 0 || markupBps >= BPS_IN_WHOLE) return null;

  const value = Money.toAmount(amount);
  if (Money.isNegative(value) || Money.isZero(value)) return null;

  const markup = Money.percentOf(value, markupBps);
  const income =
    side === 'given'
      ? markup
      : Money.divide(
          markup,
          // Остаток — тоже базисными пунктами и той же арифметикой:
          // доля, посчитанная делением чисел, теряет знаки там, где
          // деньги их не прощают.
          Money.divide(
            Money.toAmount(String(BPS_IN_WHOLE - markupBps)),
            Money.toAmount(String(BPS_IN_WHOLE)),
          ),
        );

  // Округление вниз: подсказка, завышенная на копейку, уходит в
  // начисления рефереру как настоящий доход.
  const coarse = Money.format(income, COARSE_DIGITS);
  return Money.isZero(Money.toAmount(coarse)) ? Money.format(income, FINE_DIGITS) : coarse;
}

/** Откуда пришло подсказанное число — этими словами оно и объясняется. */
export type IncomeHintSource = 'schedule' | 'markup';

export interface IncomeHint {
  readonly value: string;
  readonly source: IncomeHintSource;
}

/**
 * Что подсказать менеджеру в поле дохода — и подсказывать ли вообще.
 *
 * Путей к числу два, и выбирает между ними не экран, а то, как считалась
 * цена заявки.
 *
 * У направления со ступенчатой сеткой — THB, CNY, USD, EUR — наценки в
 * курсе нет вовсе, и до 20 сентября 2026 подсказка тут молчала: ровно на
 * тех заявках, которых у сервиса больше всего. Зато у такой заявки
 * удержанное посчитано при подаче и записано в неё (`serviceFeePayout`)
 * — в валюте выдачи и по тому курсу доллара, который стоял в ту минуту.
 *
 * Пересчитывать его в отданную клиентом валюту нечем: курс заявки — уже
 * после комиссии, и деление на него дало бы не ту величину, а курса
 * доллара на момент подачи в заявке не лежит. Поэтому при другой
 * выбранной валюте подсказка молчит, а не угадывает: доход уходит в
 * начисления рефереру и потом не правится.
 */
export function serviceIncomeHint({
  incomeCode,
  fromCode,
  toCode,
  fromAmount,
  toAmount,
  requestRate,
  feePayout,
  markupBps,
  pricedBySchedule,
}: {
  /** Валюта, выбранная менеджером в форме исполнения. */
  incomeCode: string;
  fromCode: string;
  toCode: string;
  fromAmount: string | null;
  toAmount: string | null;
  /** Курс подачи: без него цену называл менеджер, и считать нечего. */
  requestRate: string | null;
  /** Удержанное по сетке, в валюте выдачи. */
  feePayout: string | null;
  markupBps: number;
  pricedBySchedule: boolean;
}): IncomeHint | null {
  if (feePayout !== null && incomeCode === toCode) {
    /*
     * Как записано, так и подставляется: число уже округлено ядром до
     * точности валюты выдачи (`roundPayout`), и второе округление здесь
     * срезало бы знаки у монетной стороны, где весь доход — сотые.
     */
    const value = Money.toAmount(feePayout);
    return Money.isZero(value) || Money.isNegative(value)
      ? null
      : { value, source: 'schedule' };
  }

  if (requestRate === null || pricedBySchedule) return null;

  const givenSide = incomeCode === fromCode;
  const value = suggestServiceIncome({
    amount: givenSide ? fromAmount : toAmount,
    markupBps,
    side: givenSide ? 'given' : 'received',
  });
  return value === null ? null : { value, source: 'markup' };
}
