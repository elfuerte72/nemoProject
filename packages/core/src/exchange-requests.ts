import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { currencies, currencyPairs, exchangeRequestEvents, exchangeRequests } from '@nemo/db';
import { Money, type Amount, type ExchangeKind, type ExchangeRequestStatus } from '@nemo/types';
import { requireClient, type Actor } from './actor.js';
import type { CoreContext, Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import type { Notification } from './notifications.js';
import { requireOwnRequisites } from './requisites.js';

/**
 * Заявка на обмен: что клиент отдаёт, что хочет получить и на какую
 * сумму.
 *
 * Курс здесь не называется. У наличных его до разговора с менеджером
 * не существует вовсе, а у электронных переводов он справочный
 * (docs/adr/0004). Заявка — это запрос, а не сделка по зафиксированной
 * цене, и обещать цену в момент подачи означало бы обещать то, чем
 * сервис не управляет.
 */

/**
 * Заявка глазами клиента. Дохода сервиса здесь нет и быть не может:
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
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

/**
 * Направление обмена: пара валют плюс способ исполнения. Наличные и
 * электронный перевод — разные направления с разной наценкой, а не одно
 * с признаком: курс у них расходится, и объединение заставило бы
 * хранить два числа в одной строке справочника.
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

function parsePositiveAmount(value: string): Amount {
  const parsed = Money.positiveAmountSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidInputError(
      parsed.error.issues[0]?.message ?? 'Некорректная сумма заявки',
    );
  }
  return parsed.data;
}

export async function submitExchangeRequest(
  ctx: CoreContext,
  actor: Actor,
  input: SubmitExchangeRequestInput,
): Promise<SubmitExchangeRequestResult> {
  const clientId = requireClient(actor);
  const fromAmount = parsePositiveAmount(input.fromAmount);

  return ctx.db.transaction(async (tx) => {
    await requireActivePair(tx, input);
    if (input.requisitesId !== undefined) {
      await requireOwnRequisites(tx, clientId, input.requisitesId);
    }

    const [row] = await tx
      .insert(exchangeRequests)
      .values({
        clientId,
        kind: input.kind,
        fromCode: input.fromCode,
        toCode: input.toCode,
        fromAmount,
        requisitesId: input.requisitesId ?? null,
      })
      .returning();

    // История заявки начинается с того, как она появилась: иначе в
    // разборе спорной сделки первый её шаг ничем не подтверждён.
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
  ctx: CoreContext,
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
 * Заявка по идентификатору. Чужая заявка не «запрещена», а «не
 * найдена»: отличать одно от другого значило бы подтверждать
 * существование заявки тому, кто её перебирает.
 */
export async function getExchangeRequest(
  ctx: CoreContext,
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
    throw new NotFoundError('Заявка не найдена');
  }
  return toExchangeRequestView(row);
}

/** Справочник направлений для экрана обмена. */
export async function listCurrencyPairs(
  ctx: CoreContext,
): Promise<readonly CurrencyPairView[]> {
  const rows = await ctx.db
    .select({
      fromCode: currencyPairs.fromCode,
      toCode: currencyPairs.toCode,
      kind: currencyPairs.kind,
    })
    .from(currencyPairs)
    .where(eq(currencyPairs.isActive, true))
    .orderBy(asc(currencyPairs.fromCode), asc(currencyPairs.toCode), asc(currencyPairs.kind));
  return rows;
}
