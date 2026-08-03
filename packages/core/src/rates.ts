import { and, eq } from 'drizzle-orm';
import { currencyPairs } from '@nemo/db';
import { Money, type Amount } from '@nemo/types';
import type { CoreConfig, Executor } from './context.js';
import { readServiceSettings } from './settings.js';

/**
 * Котировка для электронных переводов.
 *
 * Источник котировок спрятан за одним интерфейсом: сколько за ним
 * провайдеров и какие они — деталь развёртывания. Известно, что
 * источников будет несколько, и протекать в логику заявки они не
 * должны.
 *
 * Наличные через этот интерфейс не проходят вовсе: там курс называет
 * менеджер, и котировка биржи к нему отношения не имеет.
 *
 * Курс, показанный клиенту, справочным больше не является: подав по
 * нему заявку, клиент получает обязательство сервиса (docs/adr/0006).
 * Но справочна сама эта котировка — до подачи она ни к чему не
 * обязывает и живёт ровно до следующего запроса.
 */

/** Котировка внешнего источника: сколько `toCode` дают за единицу `fromCode`. */
export interface RateQuote {
  readonly rate: Amount;
  readonly asOf: Date;
}

export interface RatePair {
  readonly fromCode: string;
  readonly toCode: string;
}

/**
 * Источник котировок. Недоступность выражается пустым ответом, а не
 * исключением: провайдер, который лежит, — обычное дело, а не авария, и
 * подача заявки от него не зависит.
 *
 * `at` спрашивает не «какой курс сейчас», а «какой курс был вот тогда».
 * Им подача заявки берёт ровно тот курс, который клиент видел на экране:
 * между показом и нажатием источник успевает обновиться, и без этого
 * человек соглашался бы на одно число, а получал другое.
 */
export interface RateSource {
  quote(pair: RatePair, at?: Date): Promise<RateQuote | null>;
}

export interface QuoteView {
  /** Курс с наценкой сервиса — тот, что видит клиент. */
  readonly rate: Amount;
  /** Сколько клиент получит по этому курсу. `null`, если сумма не указана. */
  readonly toAmount: Amount | null;
  readonly markupBps: number;
  readonly asOf: Date;
}

export interface QuoteInput extends RatePair {
  readonly fromAmount?: string | undefined;
  /**
   * Отметка времени курса, который клиент увидел. Подача присылает её
   * обратно, чтобы заявка ушла по показанному курсу, а не по тому,
   * который успел прийти следом.
   */
  readonly asOf?: Date | undefined;
}

/**
 * Наценка уменьшает то, что получает клиент: она и есть заработок
 * сервиса на обмене. Правило берётся из настроек сервиса, а не из кода
 * и не из справочника направлений: наценка одна на весь сервис, и
 * задаёт её администратор.
 */
function applyMarkup(rate: Amount, markupBps: number): Amount {
  return Money.subtract(rate, Money.percentOf(rate, markupBps));
}

/**
 * Курс до целого — и клиенту, и менеджеру.
 *
 * Число вида «81,487204 ₽ за 1 USDT» не читается и не проверяется в
 * уме: чтобы сойтись с суммой к выдаче, его пришлось бы перемножать на
 * бумаге. Целое читается с одного взгляда, и выдача по нему считается
 * устно — а значит расхождение видно сразу, а не после перевода.
 *
 * Округляется та сторона пары, что больше единицы. Обратную считать
 * нельзя: у RUB → USDT курс равен 0,0123, и целое из него — ноль.
 * Поэтому крупная сторона округляется, а мелкая выводится делением, и
 * обе стороны остаются согласованными между собой.
 *
 * Направление — всегда в пользу сервиса, и это не жадность, а
 * необходимость: наценка составляет 1,63 ₽ на курсе 81,49, а разброс
 * округления — до рубля, то есть до трети наценки. Округление «к
 * ближайшему» отдавало бы эту треть случаю.
 */
function roundRate(rate: Amount): Amount {
  const one = Money.toAmount('1');
  if (Money.compare(rate, one) >= 0) {
    // Клиент получает по этому курсу — платит сервис, и округление
    // вниз оставляет наценку целой.
    return Money.floor(rate);
  }
  // Курс мельче единицы: крупная сторона — обратная. Её округление
  // вверх означает, что за единицу получаемого клиент отдаёт больше.
  const inverse = Money.divide(one, rate);
  if (Money.isZero(inverse)) return rate;
  return Money.divide(one, Money.ceil(inverse));
}

/** Заведено ли направление безналичного обмена и не выключено ли оно. */
async function hasElectronicPair(executor: Executor, pair: RatePair): Promise<boolean> {
  const [row] = await executor
    .select({ id: currencyPairs.id })
    .from(currencyPairs)
    .where(
      and(
        eq(currencyPairs.fromCode, pair.fromCode),
        eq(currencyPairs.toCode, pair.toCode),
        eq(currencyPairs.kind, 'electronic'),
        eq(currencyPairs.isActive, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Котировка по направлению — с наценкой сервиса.
 *
 * `null` вместо отказа — во всех случаях, когда курса нет: направление
 * не заведено, источник не настроен, провайдер не ответил. Экран на
 * пустой ответ говорит, что курс назовёт менеджер, и заявку подать
 * по-прежнему можно. Отказ операции заставил бы отличать «провайдер
 * лёг» от «клиент ошибся» там, где для клиента разницы нет.
 */
export async function getQuote(
  ctx: CoreConfig,
  input: QuoteInput,
): Promise<QuoteView | null> {
  const source = ctx.rateSource;
  if (!source) return null;

  if (!(await hasElectronicPair(ctx.db, input))) return null;

  const quoted = await source.quote(
    { fromCode: input.fromCode, toCode: input.toCode },
    input.asOf,
  );
  if (!quoted) return null;

  const { markupBps } = await readServiceSettings(ctx.db);
  const rate = roundRate(applyMarkup(quoted.rate, markupBps));
  const fromAmount = Money.amountSchema.safeParse(input.fromAmount ?? '');

  return {
    rate,
    toAmount:
      fromAmount.success && !Money.isNegative(fromAmount.data)
        ? Money.multiply(fromAmount.data, rate)
        : null,
    markupBps,
    asOf: quoted.asOf,
  };
}

/**
 * Курс, по которому подана заявка, — и он же обязательство сервиса
 * (docs/adr/0006): по какому курсу клиент нажал, по такому сделка и
 * пойдёт.
 *
 * «По какому нажал» — буквально: отметку времени показанного курса
 * приложение присылает вместе с заявкой, и котировка берётся та же
 * самая. Спрошенная заново, она успевала бы обновиться между показом и
 * нажатием, и человек соглашался бы на одно число, а получал другое —
 * молча, потому что заметить это можно только сверив выдачу с тем, что
 * было на экране.
 *
 * Присланному верить при этом не нужно: приходит не курс, а ссылка на
 * снимок, который сервис сделал сам. Незнакомая отметка просто
 * откатывается на текущий курс.
 *
 * Сбой источника заявку не задерживает: без котировки поле останется
 * пустым, и заявка поведёт себя как наличная — курс назовёт менеджер.
 * Отказывать в подаче из-за молчания провайдера нельзя, для клиента это
 * выглядит поломкой сервиса.
 */
export async function quoteForSubmission(
  ctx: CoreConfig,
  input: QuoteInput,
): Promise<Amount | null> {
  try {
    const quote = await getQuote(ctx, input);
    return quote?.rate ?? null;
  } catch (error) {
    console.error('Не удалось получить котировку', error);
    return null;
  }
}
