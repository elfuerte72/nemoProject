import { asc, eq, inArray } from 'drizzle-orm';
import { currencies, exchangeRequestEvents, exchangeRequests } from '@nemo/db';
import {
  canTransition,
  exchangeRequestStatuses,
  exchangeRequestTransitions,
  Money,
  type ActorType,
  type Amount,
  type ExchangeRequestStatus,
} from '@nemo/types';
import { requireClient, requireStaff, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { requirePositiveAmount } from './amounts.js';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  TransitionNotAllowedError,
} from './errors.js';
import { toExchangeRequestView, type ExchangeRequestView } from './exchange-requests.js';
import type { Notification } from './notifications.js';
import { accrueReferralBonuses } from './referral-accruals.js';

/**
 * Путь заявки на обмен от очереди до исполнения.
 *
 * Смена состояния, запись в историю и уведомление клиента — одна
 * операция и одна транзакция. Разделять их нельзя: заявка, у которой
 * поменялся статус, но не появилось события, оставляет спорный обмен
 * без следов, а исполнение без начисления баллов тихо обворовывает
 * реферера.
 *
 * Разрешённые переходы заданы в `@nemo/types` таблицей. Всё, чего в ней
 * нет, отвергается — «на всякий случай» здесь ничего не разрешается.
 */

/**
 * Заявка на обмен глазами менеджера: с доходом по заявке и тем, кто её ведёт.
 * Клиенту это представление не отдаётся.
 */
export interface ManagerExchangeRequestView extends ExchangeRequestView {
  readonly assignedManagerId: string | null;
  readonly serviceIncome: Amount | null;
  readonly serviceIncomeCode: string | null;
}

export interface ExchangeRequestEventView {
  readonly fromStatus: ExchangeRequestStatus | null;
  readonly toStatus: ExchangeRequestStatus;
  readonly actorType: ActorType;
  readonly actorStaffId: string | null;
  readonly comment: string | null;
  readonly createdAt: Date;
}

export interface TransitionResult {
  readonly request: ManagerExchangeRequestView;
  readonly notifications: readonly Notification[];
}

/** То же, но для перехода, который выполнил клиент: без дохода по заявке. */
export interface ClientTransitionResult {
  readonly request: ExchangeRequestView;
  readonly notifications: readonly Notification[];
}

/** Внутренний результат перехода: строка, из которой строят нужное представление. */
interface AppliedTransition {
  readonly row: ExchangeRequestRow;
  readonly notifications: readonly Notification[];
}

type ExchangeRequestRow = typeof exchangeRequests.$inferSelect;

/**
 * Заявки, которые уже начали вести и ещё не закрыли.
 *
 * Выводится из таблицы переходов: завершённое состояние — то, из
 * которого перейти некуда. Перечисли их здесь руками — и новое
 * состояние молча попало бы в список работ, ничего при этом не сломав.
 */
const IN_PROGRESS_STATUSES = exchangeRequestStatuses.filter(
  (status) => status !== 'new' && exchangeRequestTransitions[status].length > 0,
);

export function toManagerView(row: ExchangeRequestRow): ManagerExchangeRequestView {
  return {
    ...toExchangeRequestView(row),
    assignedManagerId: row.assignedManagerId,
    serviceIncome: row.serviceIncome === null ? null : Money.toAmount(row.serviceIncome),
    serviceIncomeCode: row.serviceIncomeCode,
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
    throw new NotFoundError('Заявка на обмен не найдена');
  }
  return row;
}

/**
 * Заявку на обмен ведёт тот, кто её взял: клиенту звонит один человек и
 * курс называет тоже он. Невзятая заявка ничья — с ней работает любой
 * сотрудник.
 *
 * Обхода для администратора здесь нет. Заявка, застрявшая на уволенном
 * менеджере, — настоящая беда, но лечится она передачей заявки другому,
 * а не правом действовать поверх закрепления: иначе в истории окажется
 * два исполнителя, а закрепление останется за первым.
 */
export function requireOwnership(row: ExchangeRequestRow, actor: Actor): string {
  const staff = requireStaff(actor);
  if (row.assignedManagerId !== null && row.assignedManagerId !== staff.staffId) {
    throw new ForbiddenError('Заявку на обмен ведёт другой менеджер');
  }
  return staff.staffId;
}

/**
 * Что переход дописывает в заявку помимо статуса. Перечислено поимённо:
 * с `Partial` от всей строки переход мог бы поменять и клиента, и
 * состояние в обход таблицы, и собственный идентификатор.
 */
type ExchangeRequestPatch = Partial<
  Pick<
    typeof exchangeRequests.$inferInsert,
    | 'assignedManagerId'
    | 'finalRate'
    | 'toAmount'
    | 'paymentInstructions'
    | 'serviceIncome'
    | 'serviceIncomeCode'
    | 'cancelReason'
  >
>;

interface TransitionInput {
  readonly to: ExchangeRequestStatus;
  readonly actorType: ActorType;
  readonly actorStaffId?: string | undefined;
  readonly comment?: string | undefined;
  readonly patch?: ExchangeRequestPatch | undefined;
}

async function applyTransition(
  executor: Executor,
  row: ExchangeRequestRow,
  input: TransitionInput,
): Promise<AppliedTransition> {
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

  return { row: updated!, notifications: [notificationFor(updated!)] };
}

/** Переход, выполненный сотрудником: наружу уходит его представление. */
async function staffTransition(
  executor: Executor,
  row: ExchangeRequestRow,
  input: TransitionInput,
): Promise<TransitionResult> {
  const applied = await applyTransition(executor, row, input);
  return { request: toManagerView(applied.row), notifications: applied.notifications };
}

/** Очередь: заявки, которых никто не взял. */
export async function listExchangeRequestQueue(
  ctx: CoreConfig,
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

/**
 * Заявки, которые уже взяли, но ещё не закрыли.
 *
 * Без этого списка взятая заявка исчезает из интерфейса: из очереди она
 * ушла, а другого пути к её карточке нет — и назвать курс, отметить
 * оплату или исполнить её становится нечем. Тикет просит только
 * очередь, но очередь без этого списка работать не даёт.
 */
export async function listExchangeRequestsInProgress(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly ManagerExchangeRequestView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(inArray(exchangeRequests.status, IN_PROGRESS_STATUSES))
    .orderBy(asc(exchangeRequests.createdAt));
  return rows.map(toManagerView);
}

export async function getExchangeRequestForStaff(
  ctx: CoreConfig,
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
    throw new NotFoundError('Заявка на обмен не найдена');
  }
  return toManagerView(row);
}

export async function listExchangeRequestEvents(
  ctx: CoreConfig,
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
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<TransitionResult> {
  const staff = requireStaff(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    // Отдельный ответ вместо общего «переход запрещён»: менеджеру важно
    // понимать, что заявку не потеряли, а просто взял коллега. Про
    // отменённую и исполненную так сказать нельзя — их разбирает общая
    // таблица переходов, иначе отказ вводил бы в заблуждение.
    if (row.assignedManagerId !== null && row.status === 'in_progress') {
      throw new ConflictError('Заявку на обмен уже взяли в работу');
    }

    return staffTransition(tx, row, {
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
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
  input: ConfirmExchangeRateInput,
): Promise<TransitionResult> {
  const finalRate = requirePositiveAmount(input.finalRate, 'Курс');
  const toAmount =
    input.toAmount === undefined
      ? undefined
      : requirePositiveAmount(input.toAmount, 'Сумма к выдаче');
  const paymentInstructions = input.paymentInstructions.trim();
  if (!paymentInstructions) {
    throw new InvalidInputError('Укажите реквизиты для оплаты');
  }

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);

    return staffTransition(tx, row, {
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
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<TransitionResult> {
  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);

    return staffTransition(tx, row, {
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
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
  input: CompleteExchangeRequestInput,
): Promise<TransitionResult> {
  const serviceIncome = requirePositiveAmount(input.serviceIncome, 'Доход по заявке');
  const serviceIncomeCode = input.serviceIncomeCode.trim();
  if (!serviceIncomeCode) {
    throw new InvalidInputError('Укажите валюту дохода по заявке');
  }

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);
    await requireKnownCurrency(tx, serviceIncomeCode);

    const applied = await applyTransition(tx, row, {
      to: 'completed',
      actorType: 'manager',
      actorStaffId: staffId,
      patch: { serviceIncome, serviceIncomeCode },
    });

    // Начисление — часть той же транзакции, что и смена статуса: откат
    // одного откатывает другое. Разделить их значило бы допустить
    // исполненную заявку без начислений — и обнаружить это, когда
    // реферер спросит, куда делись его баллы.
    const accrued = await accrueReferralBonuses(tx, {
      requestId: row.id,
      clientId: row.clientId,
      serviceIncome,
    });

    return {
      request: toManagerView(applied.row),
      notifications: [...applied.notifications, ...accrued],
    };
  });
}

/**
 * Отмена клиентом — единственный переход, который он может выполнить, и
 * только пока заявку никто не взял. Дальше в работе участвует менеджер,
 * и бросать её на полпути клиент не может.
 *
 * Отдельная операция от менеджерской, а не общая с проверкой роли
 * внутри: у них разные правила — клиент не объясняется, менеджер обязан
 * назвать причину, — и, главное, разный ответ. Клиенту уходит его
 * представление заявки, в котором дохода по заявке нет вовсе; общая
 * операция вернула бы менеджерское, и не забыть про это пришлось бы
 * каждому маршруту.
 */
export async function cancelOwnExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<ClientTransitionResult> {
  const clientId = requireClient(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    if (row.clientId !== clientId) {
      throw new NotFoundError('Заявка на обмен не найдена');
    }
    if (row.status !== 'new') {
      throw new TransitionNotAllowedError(
        'Заявку на обмен уже взяли в работу — отменить её может только менеджер',
      );
    }

    const result = await applyTransition(tx, row, { to: 'cancelled', actorType: 'client' });
    return { request: toExchangeRequestView(result.row), notifications: result.notifications };
  });
}

/** Отмена менеджером: из любого незавершённого состояния и с причиной. */
export async function cancelExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
  input: { reason?: string | undefined } = {},
): Promise<TransitionResult> {
  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);
    const reason = input.reason?.trim();
    if (!reason) {
      // Клиент должен понимать, что произошло: отмена без причины
      // оставляет его гадать, а сервис — без объяснений в споре.
      throw new InvalidInputError('Укажите причину отмены');
    }

    return staffTransition(tx, row, {
      to: 'cancelled',
      actorType: 'manager',
      actorStaffId: staffId,
      comment: reason,
      patch: { cancelReason: reason },
    });
  });
}

/**
 * Валюта дохода сверяется со справочником, а не принимается как есть:
 * от неё считаются реферальные начисления, и «RUR» вместо «RUB»
 * означало бы вторую валюту, в которой у клиента копится отдельный, ни
 * с чем не сходящийся остаток.
 */
async function requireKnownCurrency(executor: Executor, code: string): Promise<void> {
  const [row] = await executor
    .select({ code: currencies.code })
    .from(currencies)
    .where(eq(currencies.code, code))
    .limit(1);

  if (!row) {
    throw new InvalidInputError(`Валюта ${code} не заведена в справочнике`);
  }
}
