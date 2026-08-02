import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { currencies, currencyPairs, exchangeRequestEvents, exchangeRequests } from '@nemo/db';
import { Money, type Amount, type ExchangeKind, type ExchangeRequestStatus } from '@nemo/types';
import { requireClient, type Actor } from './actor.js';
import { requirePositiveAmount } from './amounts.js';
import type { CoreConfig, Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import type { Notification } from './notifications.js';
import { quoteForSubmission } from './rates.js';
import { requireOwnRequisites } from './requisites.js';
import { MIN_EXCHANGE_CODE, readServiceSettings } from './settings.js';

/**
 * Заявка на обмен: что клиент отдаёт, что хочет получить и на какую
 * сумму.
 *
 * Курс здесь не называется. У наличных его до разговора с менеджером
 * не существует вовсе, а у электронных переводов он справочный
 * (docs/adr/0004). Заявка — это запрос, а не обмен по зафиксированной
 * цене, и обещать цену в момент подачи означало бы обещать то, чем
 * сервис не управляет.
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
  readonly preliminaryRate: Amount | null;
  readonly finalRate: Amount | null;
  readonly status: ExchangeRequestStatus;
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
 * Условия обмена для экрана заявки: куда сервис меняет и от какой суммы
 * берётся. Минимум приходит вместе с направлениями, а не отдельным
 * запросом: клиент должен узнать его до подачи, а не из отказа.
 */
export interface ExchangeTermsView {
  readonly pairs: readonly CurrencyPairView[];
  readonly minAmount: Amount;
  /** Валюта минимума: см. `MIN_EXCHANGE_CODE`. */
  readonly minAmountCode: string;
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
    preliminaryRate: toDisplayAmount(row.preliminaryRate),
    finalRate: toDisplayAmount(row.finalRate),
    status: row.status,
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
 * Рублёвая сторона заявки — та, с которой сравнивается минимальная
 * сумма обмена.
 *
 * Рубли клиент либо отдаёт, и тогда это сумма подачи, либо получает — и
 * тогда её нужно посчитать по курсу. Курса может не быть вовсе: у
 * наличных его нет до разговора с менеджером, а провайдер котировок
 * может молчать. В этом случае стороны нет, и порог не проверяется:
 * отказ по числу, которого у сервиса в этот момент не существует,
 * выглядел бы для клиента поломкой.
 */
function rubleSideOf(
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

  // Котировка запрашивается до транзакции: это обращение к чужому API,
  // и держать открытой транзакцию на время сетевого запроса значило бы
  // отдавать соединение с базой в распоряжение чужого сервиса. У
  // наличных курса нет вовсе — там финальный курс называет менеджер.
  const preliminaryRate =
    input.kind === 'electronic'
      ? await quoteForSubmission(ctx, { fromCode: input.fromCode, toCode: input.toCode })
      : null;

  return ctx.db.transaction(async (tx) => {
    await requireActivePair(tx, input);
    if (input.requisitesId !== undefined) {
      await requireOwnRequisites(tx, clientId, input.requisitesId);
    }

    const settings = await readServiceSettings(tx);
    const rubles = rubleSideOf(input, fromAmount, preliminaryRate);
    if (rubles !== null && Money.compare(rubles, settings.minExchangeAmount) < 0) {
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
        preliminaryRate,
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
  const rows = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(eq(exchangeRequests.clientId, clientId))
    .orderBy(desc(exchangeRequests.createdAt));
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

  const { minExchangeAmount } = await readServiceSettings(ctx.db);
  return { pairs, minAmount: minExchangeAmount, minAmountCode: MIN_EXCHANGE_CODE };
}
