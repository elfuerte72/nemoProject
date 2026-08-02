import { and, eq } from 'drizzle-orm';
import { currencyPairs } from '@nemo/db';
import { Money, type Amount } from '@nemo/types';
import type { CoreConfig, Executor } from './context.js';

/**
 * Предварительный курс для электронных переводов.
 *
 * Источник котировок спрятан за одним интерфейсом: сколько за ним
 * провайдеров и какие они — деталь развёртывания. Список направлений
 * ждёт блокера C1, но известно, что источников будет несколько, и
 * протекать в логику заявки они не должны.
 *
 * Наличные через этот интерфейс не проходят вовсе: там финальный курс
 * называет менеджер, и котировка биржи к нему отношения не имеет.
 *
 * Курс здесь справочный (docs/adr/0004). Он не фиксируется, ни к чему
 * сервис не обязывает и существует ради одного — чтобы клиент понимал
 * порядок суммы до подачи заявки.
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
 */
export interface RateSource {
  quote(pair: RatePair): Promise<RateQuote | null>;
}

export interface PreliminaryQuoteView {
  /** Курс с наценкой направления — тот, что видит клиент. */
  readonly rate: Amount;
  /** Сколько клиент получит по этому курсу. `null`, если сумма не указана. */
  readonly toAmount: Amount | null;
  readonly markupBps: number;
  readonly asOf: Date;
}

export interface PreliminaryQuoteInput extends RatePair {
  readonly fromAmount?: string | undefined;
}

/**
 * Наценка уменьшает то, что получает клиент: она и есть заработок
 * сервиса на направлении. Правило берётся из справочника направлений, а
 * не из кода, — его задаёт администратор (тикет 14).
 */
function applyMarkup(rate: Amount, markupBps: number): Amount {
  return Money.subtract(rate, Money.percentOf(rate, markupBps));
}

async function findElectronicPair(
  executor: Executor,
  pair: RatePair,
): Promise<{ markupBps: number } | undefined> {
  const [row] = await executor
    .select({ markupBps: currencyPairs.markupBps })
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
  return row;
}

/**
 * Предварительный курс по направлению.
 *
 * `null` вместо отказа — во всех случаях, когда курса нет: направление
 * не заведено, источник не настроен, провайдер не ответил. Экран на
 * пустой ответ говорит, что курс назовёт менеджер, и заявку подать
 * по-прежнему можно. Отказ операции заставил бы отличать «провайдер
 * лёг» от «клиент ошибся» там, где для клиента разницы нет.
 */
export async function getPreliminaryQuote(
  ctx: CoreConfig,
  input: PreliminaryQuoteInput,
): Promise<PreliminaryQuoteView | null> {
  const source = ctx.rateSource;
  if (!source) return null;

  const pair = await findElectronicPair(ctx.db, input);
  if (!pair) return null;

  const quoted = await source.quote({ fromCode: input.fromCode, toCode: input.toCode });
  if (!quoted) return null;

  const rate = applyMarkup(quoted.rate, pair.markupBps);
  const fromAmount = Money.amountSchema.safeParse(input.fromAmount ?? '');

  return {
    rate,
    toAmount:
      fromAmount.success && !Money.isNegative(fromAmount.data)
        ? Money.multiply(fromAmount.data, rate)
        : null,
    markupBps: pair.markupBps,
    asOf: quoted.asOf,
  };
}

/**
 * Курс на момент подачи заявки — чтобы менеджер видел, от чего клиент
 * отталкивался, а разбор спорного обмена не упирался в «мне показывали
 * другое». Обязательством сервиса он от этого не становится.
 *
 * Сбой источника заявку не задерживает: без котировки поле останется
 * пустым, и это ровно то, что происходит с наличными.
 */
export async function quoteForSubmission(
  ctx: CoreConfig,
  input: RatePair,
): Promise<Amount | null> {
  try {
    const quote = await getPreliminaryQuote(ctx, input);
    return quote?.rate ?? null;
  } catch (error) {
    console.error('Не удалось получить предварительный курс', error);
    return null;
  }
}
