import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { open, seal } from '@nemo/crypto';
import { bonusTransactions, clients, withdrawalRequests } from '@nemo/db';
import {
  canTransitionWithdrawal,
  Money,
  withdrawalRequestStatuses,
  isWithdrawalOpen,
  type Amount,
  type WithdrawalMethod,
  type WithdrawalRequestStatus,
} from '@nemo/types';
import { requireClient, requireStaff, type Actor } from './actor.js';
import { requirePositiveAmount } from './amounts.js';
import { bonusBalance } from './bonus-account.js';
import {
  requirePrivateKey,
  requirePublicKey,
  type CoreConfig,
  type Executor,
} from './context.js';
import { InvalidInputError, NotFoundError, TransitionNotAllowedError } from './errors.js';
import type { Notification } from './notifications.js';
import { readServiceSettings } from './settings.js';

/**
 * Заявка на вывод бонусных баллов.
 *
 * Выплату исполняет менеджер вручную, как и всё остальное движение денег
 * в сервисе: автоматических выплат в криптовалюте в этой фазе нет
 * сознательно.
 *
 * Баллы списываются в момент отметки о выплате, а не при подаче заявки.
 * Списание вперёд означало бы, что отклонённая заявка обязана вернуть
 * баллы обратно, — а возврат, не выполненный из-за сбоя, оставил бы
 * клиента без них навсегда. Пока заявка в работе, её сумма считается
 * занятой: подать вторую на те же баллы нельзя.
 *
 * Реквизиты получения шифруются тем же ключом, что и номера карт
 * (docs/adr/0002): в клиентском деплое приватного ключа нет, и прочитать
 * их может только админка.
 */

export interface WithdrawalRequestView {
  readonly id: string;
  readonly clientId: bigint;
  readonly amount: Amount;
  readonly method: WithdrawalMethod;
  /** Всё, что видно о реквизитах получения без расшифровки. */
  readonly destinationHint: string | null;
  readonly status: WithdrawalRequestStatus;
  readonly rejectReason: string | null;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
}

export interface SubmitWithdrawalInput {
  readonly amount: string;
  readonly method: WithdrawalMethod;
  /** Счёт или адрес кошелька. Наружу больше не отдаётся. */
  readonly destination: string;
}

export interface WithdrawalTransitionResult {
  readonly request: WithdrawalRequestView;
  readonly notifications: readonly Notification[];
}

type WithdrawalRow = typeof withdrawalRequests.$inferSelect;

/** Состояния, в которых заявка ещё занимает баллы клиента. */
const OPEN_STATUSES = withdrawalRequestStatuses.filter(isWithdrawalOpen);

function toView(row: WithdrawalRow): WithdrawalRequestView {
  return {
    id: row.id,
    clientId: row.clientId,
    amount: Money.toAmount(row.amount),
    method: row.method,
    destinationHint: row.destinationHint,
    status: row.status,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
  };
}

function notificationFor(row: WithdrawalRow): Notification {
  return {
    kind: 'withdrawal-request-status',
    to: row.clientId,
    status: row.status,
    amount: Money.toAmount(row.amount),
    ...(row.rejectReason === null ? {} : { rejectReason: row.rejectReason }),
  };
}

/**
 * Хвост реквизита — чтобы клиент и менеджер узнавали, куда заявлен
 * вывод, не открывая сам реквизит. Номер счёта и адрес кошелька
 * различаются длиной, но узнаётся и то и другое по последним знакам.
 */
function hint(destination: string): string {
  const tail = destination.slice(-4);
  return destination.length > 4 ? `…${tail}` : tail;
}

/**
 * Сколько клиент может вывести прямо сейчас: баланс за вычетом сумм,
 * уже заявленных к выводу.
 *
 * Без вычета две заявки, поданные подряд, вывели бы один и тот же
 * остаток дважды — списание-то происходит только при выплате.
 */
async function availableForWithdrawal(
  executor: Executor,
  clientId: bigint,
): Promise<Amount> {
  const balance = await bonusBalance(executor, clientId);
  const [row] = await executor
    .select({ total: sql<string | null>`sum(${withdrawalRequests.amount})` })
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.clientId, clientId),
        inArray(withdrawalRequests.status, OPEN_STATUSES),
      ),
    );

  const held = row?.total == null ? Money.ZERO : Money.toAmount(row.total);
  return Money.subtract(balance, held);
}

export async function submitWithdrawalRequest(
  ctx: CoreConfig,
  actor: Actor,
  input: SubmitWithdrawalInput,
): Promise<WithdrawalTransitionResult> {
  const clientId = requireClient(actor);
  const amount = requirePositiveAmount(input.amount, 'Сумма вывода');
  const destination = input.destination.trim();
  if (!destination) {
    throw new InvalidInputError('Укажите, куда перечислить выплату');
  }
  const sealed = seal(requirePublicKey(ctx), destination);

  return ctx.db.transaction(async (tx) => {
    // Строка клиента блокируется на время подсчёта: две заявки,
    // поданные одновременно, иначе прочитали бы один и тот же остаток и
    // обе прошли бы проверку.
    const [client] = await tx
      .select({ id: clients.telegramUserId })
      .from(clients)
      .where(eq(clients.telegramUserId, clientId))
      .limit(1)
      .for('update');
    if (!client) {
      throw new NotFoundError('Клиент не найден');
    }

    const settings = await readServiceSettings(tx);
    if (Money.compare(amount, settings.minWithdrawalAmount) < 0) {
      throw new InvalidInputError(
        `Минимальная сумма вывода — ${settings.minWithdrawalAmount} баллов`,
      );
    }

    const available = await availableForWithdrawal(tx, clientId);
    if (Money.compare(amount, available) > 0) {
      throw new InvalidInputError(
        `На бонусном балансе доступно ${available} баллов`,
      );
    }

    const [row] = await tx
      .insert(withdrawalRequests)
      .values({
        clientId,
        amount,
        method: input.method,
        destinationSealed: sealed,
        destinationHint: hint(destination),
      })
      .returning();

    return { request: toView(row!), notifications: [notificationFor(row!)] };
  });
}

export async function listWithdrawalRequests(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly WithdrawalRequestView[]> {
  const clientId = requireClient(actor);
  const rows = await ctx.db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.clientId, clientId))
    .orderBy(desc(withdrawalRequests.createdAt));
  return rows.map(toView);
}

/** Очередь выплат: заявки, которые ещё в работе. */
export async function listWithdrawalQueue(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly WithdrawalRequestView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select()
    .from(withdrawalRequests)
    .where(inArray(withdrawalRequests.status, OPEN_STATUSES))
    .orderBy(desc(withdrawalRequests.createdAt));
  return rows.map(toView);
}

async function lockWithdrawal(
  executor: Executor,
  requestId: string,
): Promise<WithdrawalRow> {
  const [row] = await executor
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.id, requestId))
    .limit(1)
    .for('update');
  if (!row) {
    throw new NotFoundError('Заявка на вывод не найдена');
  }
  return row;
}

interface WithdrawalPatch {
  readonly rejectReason?: string;
  readonly paidAt?: Date;
}

async function transition(
  executor: Executor,
  row: WithdrawalRow,
  to: WithdrawalRequestStatus,
  staffId: string,
  patch: WithdrawalPatch = {},
): Promise<WithdrawalRow> {
  if (!canTransitionWithdrawal(row.status, to)) {
    throw new TransitionNotAllowedError(
      `Заявку на вывод из состояния «${row.status}» нельзя перевести в «${to}»`,
    );
  }

  const [updated] = await executor
    .update(withdrawalRequests)
    .set({ ...patch, status: to, managerId: staffId })
    .where(eq(withdrawalRequests.id, row.id))
    .returning();
  return updated!;
}

export async function approveWithdrawalRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<WithdrawalTransitionResult> {
  const staff = requireStaff(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockWithdrawal(tx, requestId);
    const updated = await transition(tx, row, 'approved', staff.staffId);
    return { request: toView(updated), notifications: [notificationFor(updated)] };
  });
}

/**
 * Отметка о выплате — единственное место, где баллы списываются.
 *
 * Списание и смена состояния идут одной транзакцией: заявка,
 * помеченная выплаченной без списания, оставила бы клиенту баллы,
 * которые он уже получил деньгами.
 */
export async function markWithdrawalPaid(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<WithdrawalTransitionResult> {
  const staff = requireStaff(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockWithdrawal(tx, requestId);
    const updated = await transition(tx, row, 'paid', staff.staffId, { paidAt: new Date() });

    // Отрицательной величиной, а не отдельным знаком у движения: баланс
    // — сумма движений, и правило «одни виды сложить, другие вычесть»
    // разошлось бы между местами, где баланс считают.
    await tx.insert(bonusTransactions).values({
      clientId: row.clientId,
      kind: 'withdrawal',
      amount: Money.subtract(Money.ZERO, Money.toAmount(row.amount)),
      withdrawalRequestId: row.id,
    });

    return { request: toView(updated), notifications: [notificationFor(updated)] };
  });
}

export async function rejectWithdrawalRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
  input: { reason?: string | undefined } = {},
): Promise<WithdrawalTransitionResult> {
  const staff = requireStaff(actor);
  const reason = input.reason?.trim();
  if (!reason) {
    // Клиент должен понимать, что исправить, чтобы подать заново.
    throw new InvalidInputError('Укажите причину отказа');
  }

  return ctx.db.transaction(async (tx) => {
    const row = await lockWithdrawal(tx, requestId);
    const updated = await transition(tx, row, 'rejected', staff.staffId, {
      rejectReason: reason,
    });
    return { request: toView(updated), notifications: [notificationFor(updated)] };
  });
}

/**
 * Реквизиты получения — менеджеру, который выполняет выплату.
 *
 * Отдельной операцией, а не полем в списке заявок: расшифрованный
 * реквизит не должен уезжать на экран очереди просто потому, что
 * менеджер её открыл.
 */
export async function revealWithdrawalDestination(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<string> {
  requireStaff(actor);
  const [row] = await ctx.db
    .select({ destinationSealed: withdrawalRequests.destinationSealed })
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.id, requestId))
    .limit(1);

  if (!row) {
    throw new NotFoundError('Заявка на вывод не найдена');
  }
  if (!row.destinationSealed) {
    throw new NotFoundError('У заявки на вывод не сохранены реквизиты получения');
  }
  return open(requirePrivateKey(ctx), row.destinationSealed);
}
