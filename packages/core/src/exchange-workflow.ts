import { and, asc, eq, ne } from 'drizzle-orm';
import { exchangeRequestEvents, exchangeRequests } from '@nemo/db';
import {
  canTransition,
  Money,
  type Amount,
  type ExchangeRequestStatus,
} from '@nemo/types';
import { requireClient, requireStaff, type Actor } from './actor.js';
import type { CoreContext, Executor } from './context.js';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  TransitionNotAllowedError,
} from './errors.js';
import { toExchangeRequestView, type ExchangeRequestView } from './exchange-requests.js';
import type { Notification } from './notifications.js';

/**
 * Путь заявки от очереди до исполнения.
 *
 * Смена состояния, запись в историю и уведомление клиента — одна
 * операция и одна транзакция. Разделять их нельзя: заявка, у которой
 * поменялся статус, но не появилось события, оставляет спорную сделку
 * без следов, а исполнение без начисления баллов тихо обворовывает
 * реферера.
 *
 * Разрешённые переходы заданы в `@nemo/types` таблицей. Всё, чего в ней
 * нет, отвергается — «на всякий случай» здесь ничего не разрешается.
 */

/**
 * Заявка глазами менеджера: с доходом сервиса и тем, кто её ведёт.
 * Клиенту это представление не отдаётся.
 */
export interface ManagerExchangeRequestView extends ExchangeRequestView {
  readonly assignedManagerId: string | null;
  readonly serviceIncome: Amount | null;
  readonly serviceIncomeCode: string | null;
  readonly paymentInstructions: string | null;
  readonly requisitesId: string | null;
}

export interface ExchangeRequestEventView {
  readonly fromStatus: ExchangeRequestStatus | null;
  readonly toStatus: ExchangeRequestStatus;
  readonly actorType: 'system' | 'client' | 'manager';
  readonly actorStaffId: string | null;
  readonly comment: string | null;
  readonly createdAt: Date;
}

export interface TransitionResult {
  readonly request: ManagerExchangeRequestView;
  readonly notifications: readonly Notification[];
}

type ExchangeRequestRow = typeof exchangeRequests.$inferSelect;

export function toManagerView(row: ExchangeRequestRow): ManagerExchangeRequestView {
  return {
    ...toExchangeRequestView(row),
    assignedManagerId: row.assignedManagerId,
    serviceIncome: row.serviceIncome === null ? null : Money.toAmount(row.serviceIncome),
    serviceIncomeCode: row.serviceIncomeCode,
    paymentInstructions: row.paymentInstructions,
    requisitesId: row.requisitesId,
  };
}

/**
 * Уведомление — следствие перехода, а не отдельное действие: так его
 * нельзя забыть, добавив новый переход.
 */
function notificationFor(row: ExchangeRequestRow): Notification {
  return {
    kind: 'exchange-request-status',
    to: row.clientId,
    requestId: row.id,
    status: row.status,
    ...(row.finalRate === null ? {} : { finalRate: Money.toAmount(row.finalRate) }),
    ...(row.paymentInstructions === null
      ? {}
      : { paymentInstructions: row.paymentInstructions }),
    ...(row.cancelReason === null ? {} : { cancelReason: row.cancelReason }),
  };
}

/**
 * Строка заявки, заблокированная до конца транзакции.
 *
 * Без блокировки два менеджера, нажавшие «взять» одновременно, оба
 * прочитали бы «новая» и оба записали бы себя исполнителем.
 */
async function lockRequest(
  executor: Executor,
  requestId: string,
): Promise<ExchangeRequestRow> {
  const [row] = await executor
    .select()
    .from(exchangeRequests)
    .where(eq(exchangeRequests.id, requestId))
    .limit(1)
    .for('update');

  if (!row) {
    throw new NotFoundError('Заявка не найдена');
  }
  return row;
}

/**
 * Заявку ведёт тот, кто её взял. Администратор может вмешаться в любую:
 * менеджер увольняется, болеет и уходит в отпуск, а клиент ждать не
 * должен. Невзятая заявка ничья — с ней работает любой сотрудник.
 */
function requireOwnership(row: ExchangeRequestRow, actor: Actor): string {
  const staff = requireStaff(actor);
  const isForeign =
    row.assignedManagerId !== null && row.assignedManagerId !== staff.staffId;
  if (isForeign && staff.role !== 'admin') {
    throw new ForbiddenError('Заявку ведёт другой менеджер');
  }
  return staff.staffId;
}

interface TransitionInput {
  readonly to: ExchangeRequestStatus;
  readonly actorType: 'system' | 'client' | 'manager';
  readonly actorStaffId?: string | undefined;
  readonly comment?: string | undefined;
  readonly patch?: Partial<typeof exchangeRequests.$inferInsert> | undefined;
}

async function applyTransition(
  executor: Executor,
  row: ExchangeRequestRow,
  input: TransitionInput,
): Promise<TransitionResult> {
  if (!canTransition(row.status, input.to)) {
    throw new TransitionNotAllowedError(
      `Из состояния «${row.status}» нельзя перейти в «${input.to}»`,
    );
  }

  const [updated] = await executor
    .update(exchangeRequests)
    .set({
      ...input.patch,
      status: input.to,
      updatedAt: new Date(),
      ...(input.to === 'completed' ? { completedAt: new Date() } : {}),
    })
    .where(eq(exchangeRequests.id, row.id))
    .returning();

  await executor.insert(exchangeRequestEvents).values({
    requestId: row.id,
    fromStatus: row.status,
    toStatus: input.to,
    actorType: input.actorType,
    actorStaffId: input.actorStaffId ?? null,
    comment: input.comment ?? null,
  });

  return { request: toManagerView(updated!), notifications: [notificationFor(updated!)] };
}

/** Очередь: заявки, которых никто не взял. */
export async function listExchangeRequestQueue(
  ctx: CoreContext,
  actor: Actor,
): Promise<readonly ManagerExchangeRequestView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(eq(exchangeRequests.status, 'new'))
    .orderBy(asc(exchangeRequests.createdAt));
  return rows.map(toManagerView);
}

/** Все заявки в работе — чтобы менеджер видел, что на нём висит. */
export async function listExchangeRequestsInProgress(
  ctx: CoreContext,
  actor: Actor,
): Promise<readonly ManagerExchangeRequestView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(
      and(
        ne(exchangeRequests.status, 'new'),
        ne(exchangeRequests.status, 'completed'),
        ne(exchangeRequests.status, 'cancelled'),
      ),
    )
    .orderBy(asc(exchangeRequests.createdAt));
  return rows.map(toManagerView);
}

export async function getExchangeRequestForStaff(
  ctx: CoreContext,
  actor: Actor,
  requestId: string,
): Promise<ManagerExchangeRequestView> {
  requireStaff(actor);
  const [row] = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(eq(exchangeRequests.id, requestId))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Заявка не найдена');
  }
  return toManagerView(row);
}

export async function listExchangeRequestEvents(
  ctx: CoreContext,
  actor: Actor,
  requestId: string,
): Promise<readonly ExchangeRequestEventView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select()
    .from(exchangeRequestEvents)
    .where(eq(exchangeRequestEvents.requestId, requestId))
    .orderBy(asc(exchangeRequestEvents.createdAt), asc(exchangeRequestEvents.id));

  return rows.map((row) => ({
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorType: row.actorType,
    actorStaffId: row.actorStaffId,
    comment: row.comment,
    createdAt: row.createdAt,
  }));
}

export async function claimExchangeRequest(
  ctx: CoreContext,
  actor: Actor,
  requestId: string,
): Promise<TransitionResult> {
  const staff = requireStaff(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    // Отдельный ответ вместо общего «переход запрещён»: менеджеру важно
    // понимать, что заявку не потеряли, а просто взял коллега.
    if (row.status !== 'new') {
      throw new ConflictError('Заявку уже взяли в работу');
    }

    return applyTransition(tx, row, {
      to: 'in_progress',
      actorType: 'manager',
      actorStaffId: staff.staffId,
      patch: { assignedManagerId: staff.staffId },
    });
  });
}

export interface ConfirmExchangeRateInput {
  readonly finalRate: string;
  /** Сколько клиент получит по названному курсу. */
  readonly toAmount?: string | undefined;
  /** Куда клиенту платить. */
  readonly paymentInstructions: string;
}

export async function confirmExchangeRate(
  ctx: CoreContext,
  actor: Actor,
  requestId: string,
  input: ConfirmExchangeRateInput,
): Promise<TransitionResult> {
  const finalRate = parsePositive(input.finalRate, 'Курс должен быть больше нуля');
  const toAmount =
    input.toAmount === undefined
      ? undefined
      : parsePositive(input.toAmount, 'Встречная сумма должна быть больше нуля');
  const paymentInstructions = input.paymentInstructions.trim();
  if (!paymentInstructions) {
    throw new InvalidInputError('Укажите реквизиты для оплаты');
  }

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);

    return applyTransition(tx, row, {
      to: 'rate_confirmed',
      actorType: 'manager',
      actorStaffId: staffId,
      patch: {
        finalRate,
        paymentInstructions,
        ...(toAmount === undefined ? {} : { toAmount }),
      },
    });
  });
}

export async function markPaymentReceived(
  ctx: CoreContext,
  actor: Actor,
  requestId: string,
): Promise<TransitionResult> {
  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);

    return applyTransition(tx, row, {
      to: 'payment_received',
      actorType: 'manager',
      actorStaffId: staffId,
    });
  });
}

export interface CompleteExchangeRequestInput {
  /** Сколько сервис заработал на этой заявке — база реферальных начислений. */
  readonly serviceIncome: string;
  readonly serviceIncomeCode: string;
}

export async function completeExchangeRequest(
  ctx: CoreContext,
  actor: Actor,
  requestId: string,
  input: CompleteExchangeRequestInput,
): Promise<TransitionResult> {
  const serviceIncome = parsePositive(
    input.serviceIncome,
    'Доход по заявке должен быть больше нуля',
  );
  const serviceIncomeCode = input.serviceIncomeCode.trim();
  if (!serviceIncomeCode) {
    throw new InvalidInputError('Укажите валюту дохода');
  }

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);

    return applyTransition(tx, row, {
      to: 'completed',
      actorType: 'manager',
      actorStaffId: staffId,
      patch: { serviceIncome, serviceIncomeCode },
    });
  });
}

/**
 * Отмена — единственный переход, доступный клиенту, и только пока
 * заявку никто не взял. Дальше в работе уже участвует менеджер, и
 * бросать её на полпути клиент не может.
 */
export async function cancelExchangeRequest(
  ctx: CoreContext,
  actor: Actor,
  requestId: string,
  input: { reason?: string | undefined } = {},
): Promise<TransitionResult> {
  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);

    if (actor.type === 'client') {
      const clientId = requireClient(actor);
      if (row.clientId !== clientId) {
        throw new NotFoundError('Заявка не найдена');
      }
      if (row.status !== 'new') {
        throw new TransitionNotAllowedError(
          'Заявку уже взяли в работу — отменить её может только менеджер',
        );
      }
      return applyTransition(tx, row, { to: 'cancelled', actorType: 'client' });
    }

    const staffId = requireOwnership(row, actor);
    const reason = input.reason?.trim();
    if (!reason) {
      // Клиент должен понимать, что произошло: отмена без причины
      // оставляет его гадать, а сервис — без объяснений в споре.
      throw new InvalidInputError('Укажите причину отмены');
    }

    return applyTransition(tx, row, {
      to: 'cancelled',
      actorType: 'manager',
      actorStaffId: staffId,
      comment: reason,
      patch: { cancelReason: reason },
    });
  });
}

function parsePositive(value: string, message: string): Amount {
  const parsed = Money.positiveAmountSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidInputError(message);
  }
  return parsed.data;
}
