import { and, eq } from 'drizzle-orm';
import { currencies, currencyPairs } from '@nemo/db';
import {
  Money,
  payoutAfterFee,
  roundRate,
  type Amount,
  type ExchangeKind,
  type FeeTier,
  type PayoutMethod,
} from '@nemo/types';
import type { CoreConfig, Executor } from './context.js';
import { readFeeSchedule, type ActiveFeeSchedule } from './fee-schedules.js';
import { readServiceSettings } from './settings.js';

/**
 * Котировка для электронных переводов.
 *
 * Источник котировок спрятан за одним интерфейсом: сколько за ним
 * провайдеров и какие они — деталь развёртывания. Известно, что
 * источников будет несколько, и протекать в логику заявки они не
 * должны.
 *
 * Наличные проходят через него же и считаются так же: та же биржевая
 * котировка, та же наценка. Своя ставка у них бывает — отдельной сеткой
 * ступеней, которую администратор заводит в панели, — и тогда она
 * перебивает наценку. Пока не заведена, наличная сделка не молчит о
 * цене: обменник открывают ради неё.
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
  /**
   * Сколько знаков у валюты выдачи — тот же, каким округлило ядро.
   *
   * Отдаётся экрану не ради показа, а ради счёта: сумму он считает сам,
   * и округлять её обязан тем же знаком. Свой список точностей на
   * клиенте разошёлся бы со справочником в тот день, когда
   * администратор заведёт новую валюту.
   */
  readonly payoutDecimals: number;
  readonly asOf: Date;
  /**
   * Долларовый эквивалент отдаваемой суммы — есть только там, где цену
   * назначает сетка комиссии.
   *
   * Наружу он нужен не ради показа (клиент долларов не видит), а ради
   * минимальной суммы обмена: порог задан в USDT, а у пары «рубли —
   * баты» этой валюты нет ни с одной стороны. Без него заявку можно
   * подать на полсотни рублей.
   */
  readonly usdAmount?: Amount;
  /**
   * Цена пути целиком — только там, где её назначает сетка комиссии.
   *
   * Отдаётся экрану, чтобы он считал сам, а не спрашивал сервер на
   * каждую набранную цифру: со ступенями курс зависит от суммы, и круг
   * по сети означал бы секунду ожидания на каждый символ. Считает экран
   * той же арифметикой из `@nemo/types`, что и ядро, — число сходится
   * с тем, что запишется в заявку.
   */
  readonly fee?: {
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
  };
}

export interface QuoteInput extends RatePair {
  readonly fromAmount?: string | undefined;
  /**
   * Куда уйдут деньги. От этого зависит ставка: перевод в тайский банк
   * стоит сервису не столько же, сколько перевод в кошелёк. Без него
   * берётся банковская сетка — тот способ, которым выдают чаще.
   */
  readonly payoutMethod?: PayoutMethod | undefined;
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
 * Сколько клиент получит — с точностью самой валюты.
 *
 * Как и у курса, округляется не показ, а сама величина: она уходит в
 * заявку и по ней выдают деньги, а число на экране, разошедшееся с
 * выплатой, — худшее из возможного.
 *
 * До целого числа единиц округляли до 24 августа 2026, и правило это
 * отменено: хвост доставался сервису сверх уже названной комиссии — до
 * единицы валюты, то есть около доллара на монете, — а клиент, считая
 * по названной ставке, получал меньше своего расчёта. Владелец сверял
 * доллар и не досчитался восьмидесяти трёх центов. Теперь знак берётся
 * из справочника валют, и округление идёт к ближайшему.
 */
export function roundPayout(amount: Amount, decimals: number): Amount {
  return Money.isNegative(amount) ? amount : Money.roundTo(amount, decimals);
}

/**
 * Сколько знаков у валюты выдачи.
 *
 * Спрашивается у справочника, а не берётся из таблицы в коде: состав
 * валют — решение администратора, и вторая правда о точности разошлась
 * бы с первой молча. Неизвестной валюты здесь быть не может — пару
 * проверяют выше по коду, — но если справочник промолчал, целое
 * безопаснее выдумки: так считалось до этой правки.
 */
async function readPayoutDecimals(executor: Executor, code: string): Promise<number> {
  const [row] = await executor
    .select({ decimals: currencies.decimals })
    .from(currencies)
    .where(eq(currencies.code, code))
    .limit(1);
  return row?.decimals ?? 0;
}

/**
 * Есть ли такое направление и таким ли способом.
 *
 * Вид сделки спрашивается вместе с парой: наличными и переводом сервис
 * торгует не одним и тем же списком, и курс наличных у направления,
 * которого наличными нет, взяться не может.
 */
async function hasActivePair(
  executor: Executor,
  pair: RatePair,
  kind: ExchangeKind,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: currencyPairs.id })
    .from(currencyPairs)
    .where(
      and(
        eq(currencyPairs.fromCode, pair.fromCode),
        eq(currencyPairs.toCode, pair.toCode),
        eq(currencyPairs.kind, kind),
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

  /*
   * Способ выдачи говорит и о виде сделки: наличные не приходят ни на
   * карту, ни на кошелёк, и заявка с ними — наличная. Поэтому пара
   * ищется того же вида, а не всегда безналичная.
   */
  const payoutMethod = input.payoutMethod ?? 'bank';
  const cash = payoutMethod === 'cash';
  if (!(await hasActivePair(ctx.db, input, cash ? 'cash' : 'electronic'))) return null;

  /*
   * Сетка комиссии, если владелец прислал её на это направление. Есть —
   * считаем по ТЗ, через долларовый эквивалент; нет — по наценке, как
   * было до ступеней.
   */
  const schedule = await readFeeSchedule(ctx.db, input.toCode, payoutMethod);
  if (schedule) return quoteByFee(ctx, input, schedule);

  /*
   * Сетки у направления нет — считаем по наценке, и наличная сделка
   * здесь ничем не выделена. Раньше она выделялась: пустая наличная
   * сетка означала отсутствие курса вовсе, потому что наличный обмен
   * стоит сервису другого — касса, встреча, риск. Правило отменено 14
   * августа 2026: цена — то единственное, за чем открывают обменник, и
   * молчать о ней, пока администратор не завёл сетку на каждое наличное
   * направление, значит терять клиента на первом экране. Ставка, если
   * она у наличных своя, по-прежнему задаётся сеткой из панели и
   * перебивает наценку — на строку выше.
   */
  const quoted = await source.quote(
    { fromCode: input.fromCode, toCode: input.toCode },
    input.asOf,
  );
  if (!quoted) return null;

  const { markupBps } = await readServiceSettings(ctx.db);
  /*
   * Курс округляется до сотых — и клиенту, и менеджеру — правилом из
   * `@nemo/types` (`roundRate`): тем же, которым он потом читается.
   * Своей копии правила здесь нет намеренно: два правила, разойдясь в
   * одном знаке, дали бы курс, который ядро посчитало одним числом, а
   * экран показал другим, — а сумма к выдаче считается именно по нему.
   * Направление — в пользу сервиса: «к ближайшему» на обратном счёте
   * выдавало бы больше, чем куплено.
   */
  const rate = roundRate(applyMarkup(quoted.rate, markupBps));
  const fromAmount = Money.amountSchema.safeParse(input.fromAmount ?? '');
  const payoutDecimals = await readPayoutDecimals(ctx.db, input.toCode);

  return {
    rate,
    toAmount:
      fromAmount.success && !Money.isNegative(fromAmount.data)
        ? roundPayout(Money.multiply(fromAmount.data, rate), payoutDecimals)
        : null,
    markupBps,
    payoutDecimals,
    asOf: quoted.asOf,
  };
}

/** Опорная валюта пути: через неё идут и деньги сервиса, и расчёт ступени. */
const BASE_CODE = 'USDT';

/**
 * Котировка направления, у которого есть сетка комиссии.
 *
 * Путь из ТЗ владельца: `RUB → USD → комиссия → THB`. Сумма переводится
 * в доллары, по долларовому эквиваленту выбирается ступень, ставка
 * вычитается в долларах, остаток умножается на курс валюты выдачи.
 * Клиент долларов не видит — они нужны затем, чтобы у бата и юаня
 * ступени считались одной линейкой.
 *
 * Наценка сервиса сюда не приходит вовсе: комиссия её заменяет, а не
 * дополняет, иначе клиент платит дважды — процент, спрятанный в курсе,
 * и ставку поверх него.
 *
 * Без суммы котировки нет. Со ступенями курс от неё зависит: на ста
 * долларах фиксированная ставка — это десятая часть, на пяти тысячах —
 * две тысячных. Один курс на направление тут назвать нечем, а назвать
 * его без комиссии значило бы пообещать больше, чем сервис отдаст.
 */
async function quoteByFee(
  ctx: CoreConfig,
  input: QuoteInput,
  schedule: ActiveFeeSchedule,
): Promise<QuoteView | null> {
  const source = ctx.rateSource;
  if (!source) return null;

  const fromAmount = Money.amountSchema.safeParse(input.fromAmount ?? '');
  if (!fromAmount.success || Money.isNegative(fromAmount.data) || Money.isZero(fromAmount.data)) {
    return null;
  }

  /*
   * Оба звена пути спрашиваются на одну отметку времени: заявка уходит
   * по тому курсу, который клиент видел, и свежая половина рядом со
   * старой дала бы цену, которой на экране не было.
   *
   * USDT считается долларом (docs/adr/0007), поэтому у монеты первое
   * звено — единица, а не запрос к провайдеру о самой себе.
   */
  const fromBase = await source.quote(
    { fromCode: BASE_CODE, toCode: input.toCode },
    input.asOf,
  );
  if (!fromBase) return null;

  /*
   * У монеты первое звено — единица, а не запрос к провайдеру о самой
   * себе. Отметка времени у неё берётся от второго звена: своей у
   * единицы нет, а «сейчас» означало бы, что половина цены свежее, чем
   * весь остальной путь.
   */
  const toBase =
    input.fromCode.toUpperCase() === BASE_CODE
      ? { rate: Money.toAmount('1'), asOf: fromBase.asOf }
      : await source.quote({ fromCode: input.fromCode, toCode: BASE_CODE }, input.asOf);
  if (!toBase) return null;

  const usdAmount = Money.multiply(fromAmount.data, toBase.rate);
  const payoutDecimals = await readPayoutDecimals(ctx.db, input.toCode);
  /*
   * Путь целиком считает `payoutAfterFee`, а не «остаток на курс»:
   * фикс ступени бывает задан в валюте выдачи и вычитается после
   * умножения — десять евро остаются десятью при любом курсе.
   */
  const payout = roundPayout(
    payoutAfterFee(usdAmount, fromBase.rate, schedule.tiers),
    payoutDecimals,
  );

  /*
   * Курс называется от посчитанной выдачи, а не наоборот: показанное
   * число должно сходиться с тем, что сервис отдаст, а обратный порядок
   * (посчитать курс, потом умножить) разошёлся бы с ним на хвост
   * округления.
   */
  const rate = Money.divide(payout, fromAmount.data);

  return {
    rate,
    toAmount: payout,
    usdAmount,
    fee: {
      toBaseRate: toBase.rate,
      fromBaseRate: fromBase.rate,
      tiers: schedule.tiers,
      minUsd: schedule.minUsd,
    },
    // Наценки в этой цене нет: её место заняла комиссия.
    markupBps: 0,
    payoutDecimals,
    // Отметка старшего из звеньев: цена не свежее самой несвежей своей
    // половины.
    asOf: toBase.asOf <= fromBase.asOf ? toBase.asOf : fromBase.asOf,
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
 * пустым, и курс такой заявке назовёт менеджер. Отказывать в подаче
 * из-за молчания провайдера нельзя, для клиента это выглядит поломкой
 * сервиса.
 */
export async function quoteForSubmission(
  ctx: CoreConfig,
  input: QuoteInput,
): Promise<QuoteView | null> {
  try {
    return await getQuote(ctx, input);
  } catch (error) {
    console.error('Не удалось получить котировку', error);
    return null;
  }
}
