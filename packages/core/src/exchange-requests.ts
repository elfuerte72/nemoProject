import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { currencies, currencyPairs, exchangeRequestEvents, exchangeRequests } from '@nemo/db';
import {
  Money,
  type Amount,
  type CurrencyKind,
  type ExchangeKind,
  type ExchangeRequestStatus,
} from '@nemo/types';
import { requireClient, type Actor } from './actor.js';
import { requirePositiveAmount } from './amounts.js';
import { CLIENT_HISTORY_LIMIT } from './client-history.js';
import type { CoreConfig, Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import type { Notification } from './notifications.js';
import { quoteForSubmission, roundPayout } from './rates.js';
import { requireSuitableRequisites } from './requisites.js';
import { MIN_EXCHANGE_CODE, readServiceSettings } from './settings.js';

/**
 * Заявка на обмен: что клиент отдаёт, что хочет получить и на какую
 * сумму.
 *
 * Курс безналичной заявки называется при подаче и дальше не меняется:
 * по какому курсу клиент нажал — по такому сервис и работает
 * (docs/adr/0006). Обязательство ограничено сроком: не оплатил вовремя
 * — заявка отменяется.
 *
 * У наличной заявки курса нет: котировок наличного рынка у сервиса нет,
 * и называет его менеджер. Так же ведёт себя безналичная заявка,
 * поданная при молчащем источнике котировок, — отказывать в подаче
 * из-за молчания провайдера нельзя, для клиента это выглядит поломкой.
 */

/**
 * Заявка на обмен глазами клиента. Дохода сервиса здесь нет и быть не может:
 * это внутренняя величина, из которой считаются реферальные начисления.
 */
export interface ExchangeRequestView {
  readonly id: string;
  readonly clientId: bigint;
  readonly kind: ExchangeKind;
  readonly fromCode: string;
  readonly toCode: string;
  readonly fromAmount: Amount;
  readonly toAmount: Amount | null;
  /**
   * Курс, по которому подана заявка. У безналичной — обязательство
   * сервиса; пусто у наличной и у поданной при молчащем источнике.
   */
  readonly requestRate: Amount | null;
  readonly finalRate: Amount | null;
  readonly status: ExchangeRequestStatus;
  /**
   * Когда менеджер выдал реквизиты. От этого момента идёт срок оплаты:
   * сколько его осталось, экран считает по сроку из условий обмена.
   */
  readonly requisitesIssuedAt: Date | null;
  /**
   * Куда ушли деньги по этой заявке. Клиенту он нужен, чтобы следующая
   * заявка в ту же валюту открывалась на той же записи, а не заставляла
   * выбирать заново.
   */
  readonly requisitesId: string | null;
  /**
   * Куда клиенту платить. Названы менеджером и показываются в самой
   * заявке, а не только в сообщении бота: клиент возвращается к ней
   * через день и не должен искать сообщение в переписке.
   */
  readonly paymentInstructions: string | null;
  readonly cancelReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

export interface SubmitExchangeRequestInput {
  readonly kind: ExchangeKind;
  readonly fromCode: string;
  readonly toCode: string;
  readonly fromAmount: string;
  /** Куда отправлять деньги. Реквизиты клиент подтверждает при подаче. */
  readonly requisitesId?: string | undefined;
  /**
   * Отметка времени курса, который клиент видел на экране. По нему
   * заявка и уходит (docs/adr/0006) — спрошенный заново курс успевал бы
   * обновиться между показом и нажатием.
   */
  readonly quotedAt?: Date | undefined;
}

export interface SubmitExchangeRequestResult {
  readonly request: ExchangeRequestView;
  readonly notifications: readonly Notification[];
}

export interface CurrencyPairView {
  readonly fromCode: string;
  readonly toCode: string;
  readonly kind: ExchangeKind;
}

/**
 * Валюта направления с её родом. Род нужен экрану, а не только ядру: от
 * него зависит, какой реквизит подходит заявке, и вычислять его по коду
 * валюты приложение не должно — «USDT это криптовалюта» знает
 * справочник.
 */
export interface TermsCurrencyView {
  readonly code: string;
  readonly kind: CurrencyKind;
}

/**
 * Условия обмена для экрана заявки: куда сервис меняет и от какой суммы
 * берётся. Минимум приходит вместе с направлениями, а не отдельным
 * запросом: клиент должен узнать его до подачи, а не из отказа.
 */
export interface ExchangeTermsView {
  readonly pairs: readonly CurrencyPairView[];
  readonly currencies: readonly TermsCurrencyView[];
  readonly minAmount: Amount;
  /** Валюта минимума: см. `MIN_EXCHANGE_CODE`. */
  readonly minAmountCode: string;
  /**
   * Сколько заявка ждёт оплаты после выдачи реквизитов, в минутах.
   * Экран считает по нему, сколько времени у клиента осталось.
   */
  readonly unpaidTtlMinutes: number;
}

type ExchangeRequestRow = typeof exchangeRequests.$inferSelect;

/**
 * Денежные величины нормализуются: база хранит `numeric(38, 18)` и
 * отдаёт `100.000000000000000000` там, где клиент вводил `100`. Хвост
 * нулей не несёт смысла, а в интерфейсе выглядит ошибкой.
 */
function toDisplayAmount(value: string | null): Amount | null {
  return value === null ? null : Money.toAmount(value);
}

export function toExchangeRequestView(row: ExchangeRequestRow): ExchangeRequestView {
  return {
    id: row.id,
    clientId: row.clientId,
    kind: row.kind,
    fromCode: row.fromCode,
    toCode: row.toCode,
    fromAmount: Money.toAmount(row.fromAmount),
    toAmount: toDisplayAmount(row.toAmount),
    requestRate: toDisplayAmount(row.requestRate),
    finalRate: toDisplayAmount(row.finalRate),
    status: row.status,
    requisitesIssuedAt: row.requisitesIssuedAt,
    requisitesId: row.requisitesId,
    paymentInstructions: row.paymentInstructions,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

/**
 * Направление обмена: пара валют плюс способ исполнения. Наличные и
 * электронный перевод — разные направления, а не одно с признаком:
 * безналичный курс сервис берёт у биржи, наличный называет менеджер, и
 * включить или выключить их нужно порознь.
 */
async function requireActivePair(
  executor: Executor,
  input: { fromCode: string; toCode: string; kind: ExchangeKind },
): Promise<void> {
  const [pair] = await executor
    .select({ id: currencyPairs.id })
    .from(currencyPairs)
    .where(
      and(
        eq(currencyPairs.fromCode, input.fromCode),
        eq(currencyPairs.toCode, input.toCode),
        eq(currencyPairs.kind, input.kind),
        eq(currencyPairs.isActive, true),
      ),
    )
    .limit(1);

  if (!pair) {
    throw new NotFoundError(
      `Направление ${input.fromCode} → ${input.toCode} (${input.kind}) недоступно`,
    );
  }

  // Валюта могла быть отключена отдельно от направления: закрывая
  // валюту целиком, администратор не обязан помнить про каждую пару.
  const active = await executor
    .select({ code: currencies.code })
    .from(currencies)
    .where(
      and(
        inArray(currencies.code, [input.fromCode, input.toCode]),
        eq(currencies.isActive, true),
      ),
    );

  if (active.length < 2) {
    throw new NotFoundError(
      `Направление ${input.fromCode} → ${input.toCode} недоступно: валюта отключена`,
    );
  }
}

/**
 * Сторона заявки, с которой сравнивается минимальная сумма обмена, — та,
 * что выражена в валюте порога (`MIN_EXCHANGE_CODE`).
 *
 * Эту валюту клиент либо отдаёт, и тогда это сумма подачи, либо получает
 * — и тогда её нужно посчитать по курсу. Курса может не быть вовсе: у
 * наличных его нет до разговора с менеджером, а провайдер котировок
 * может молчать. В этом случае стороны нет, и порог не проверяется:
 * отказ по числу, которого у сервиса в этот момент не существует,
 * выглядел бы для клиента поломкой.
 */
function thresholdSideOf(
  input: { fromCode: string; toCode: string },
  fromAmount: Amount,
  rate: Amount | null,
): Amount | null {
  if (input.fromCode === MIN_EXCHANGE_CODE) return fromAmount;
  if (input.toCode === MIN_EXCHANGE_CODE && rate !== null) {
    return Money.multiply(fromAmount, rate);
  }
  return null;
}

export async function submitExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  input: SubmitExchangeRequestInput,
): Promise<SubmitExchangeRequestResult> {
  const clientId = requireClient(actor);
  const fromAmount = requirePositiveAmount(input.fromAmount, 'Сумма заявки');

  // Электронный перевод без реквизитов исполнить невозможно: деньги
  // некуда отправить. Правило живёт здесь, а не в форме, потому что
  // форма — не единственный способ вызвать операцию, а последствие у
  // пропуска одно на всех: заявка, застрявшая у менеджера.
  if (input.kind === 'electronic' && input.requisitesId === undefined) {
    throw new InvalidInputError(
      'Для электронного перевода нужны реквизиты: укажите, куда отправить деньги',
    );
  }
  // Наличные клиент получает на руки. Приложенный к такой заявке
  // реквизит означал бы, что менеджер отправит перевод туда, куда клиент
  // денег не ждёт: два способа получения у одной заявки не бывает.
  if (input.kind === 'cash' && input.requisitesId !== undefined) {
    throw new InvalidInputError(
      'Наличные выдаются на руки: реквизиты для перевода к такой заявке не прикладываются',
    );
  }

  // Котировка запрашивается до транзакции: это обращение к чужому API,
  // и держать открытой транзакцию на время сетевого запроса значило бы
  // отдавать соединение с базой в распоряжение чужого сервиса. У
  // наличных курса нет вовсе — там курс называет менеджер.
  const requestRate =
    input.kind === 'electronic'
      ? await quoteForSubmission(ctx, {
          fromCode: input.fromCode,
          toCode: input.toCode,
          asOf: input.quotedAt,
        })
      : null;

  return ctx.db.transaction(async (tx) => {
    await requireActivePair(tx, input);
    if (input.requisitesId !== undefined) {
      await requireSuitableRequisites(tx, clientId, input.requisitesId, input.toCode);
    }

    const settings = await readServiceSettings(tx);
    const measured = thresholdSideOf(input, fromAmount, requestRate);
    if (measured !== null && Money.compare(measured, settings.minExchangeAmount) < 0) {
      throw new InvalidInputError(
        `Минимальная сумма обмена — ${settings.minExchangeAmount} ${MIN_EXCHANGE_CODE}`,
      );
    }

    const [row] = await tx
      .insert(exchangeRequests)
      .values({
        clientId,
        kind: input.kind,
        fromCode: input.fromCode,
        toCode: input.toCode,
        fromAmount,
        requestRate,
        // Сумма к получению — такое же обещание, как и курс: клиент
        // видел её в калькуляторе и по ней принимал решение. Считается
        // здесь, а не набирается менеджером руками, иначе обещание
        // держалось бы на его внимательности.
        toAmount:
          requestRate === null ? null : roundPayout(Money.multiply(fromAmount, requestRate)),
        requisitesId: input.requisitesId ?? null,
      })
      .returning();

    // История заявки начинается с того, как она появилась: иначе в
    // разборе спорного обмена первый её шаг ничем не подтверждён.
    await tx.insert(exchangeRequestEvents).values({
      requestId: row!.id,
      fromStatus: null,
      toStatus: 'new',
      actorType: 'client',
    });

    const request = toExchangeRequestView(row!);
    return {
      request,
      notifications: [
        {
          kind: 'exchange-request-status',
          to: clientId,
          requestId: request.id,
          status: 'new',
        },
      ],
    };
  });
}

export async function listExchangeRequests(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly ExchangeRequestView[]> {
  const clientId = requireClient(actor);
  // Незакрытая заявка в этот кусок попадает всегда: она живёт часами, а
  // потолок отсекает полсотни более свежих — столько за это время
  // руками не подать.
  const rows = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(eq(exchangeRequests.clientId, clientId))
    .orderBy(desc(exchangeRequests.createdAt))
    .limit(CLIENT_HISTORY_LIMIT);
  return rows.map(toExchangeRequestView);
}

/**
 * Заявка на обмен по идентификатору. Чужая заявка не «запрещена», а «не
 * найдена»: отличать одно от другого значило бы подтверждать
 * существование заявки тому, кто её перебирает.
 */
export async function getExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<ExchangeRequestView> {
  const clientId = requireClient(actor);
  const [row] = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(and(eq(exchangeRequests.id, requestId), eq(exchangeRequests.clientId, clientId)))
    .limit(1);

  if (!row) {
    throw new NotFoundError('Заявка на обмен не найдена');
  }
  return toExchangeRequestView(row);
}

/** Условия обмена для экрана заявки: направления и минимальная сумма. */
export async function getExchangeTerms(ctx: CoreConfig): Promise<ExchangeTermsView> {
  const pairs = await ctx.db
    .select({
      fromCode: currencyPairs.fromCode,
      toCode: currencyPairs.toCode,
      kind: currencyPairs.kind,
    })
    .from(currencyPairs)
    .where(eq(currencyPairs.isActive, true))
    .orderBy(asc(currencyPairs.fromCode), asc(currencyPairs.toCode), asc(currencyPairs.kind));

  const active = await ctx.db
    .select({ code: currencies.code, kind: currencies.kind })
    .from(currencies)
    .where(eq(currencies.isActive, true))
    .orderBy(asc(currencies.code));

  const settings = await readServiceSettings(ctx.db);
  return {
    pairs,
    currencies: active,
    minAmount: settings.minExchangeAmount,
    minAmountCode: MIN_EXCHANGE_CODE,
    unpaidTtlMinutes: settings.unpaidExchangeRequestTtlMinutes,
  };
}
