import { desc, eq, inArray } from 'drizzle-orm';
import { cardApplications, clients } from '@nemo/db';
import {
  canTransitionCardApplication,
  cardApplicationStatuses,
  isCardApplicationOpen,
  type CardApplicationStatus,
} from '@nemo/types';
import { requireClient, requireStaff, type Actor } from './actor.js';
import { CLIENT_HISTORY_LIMIT } from './client-history.js';
import type { CoreConfig, Executor } from './context.js';
import { ConflictError, NotFoundError, TransitionNotAllowedError } from './errors.js';
import type { Notification } from './notifications.js';

/**
 * Заявка на виртуальную карту.
 *
 * Сервис карту не выпускает, её данных не хранит и операций по ней не
 * проводит (docs/adr/0004). Всё, что здесь есть, — состояние заявки,
 * которое менеджер ведёт по ответам внешнего провайдера, и ссылка на
 * неё в системе провайдера, чтобы было по чему свериться.
 */

export interface CardApplicationView {
  readonly id: string;
  readonly clientId: bigint;
  readonly status: CardApplicationStatus;
  /** Номер заявки у провайдера. Не данные карты — их у сервиса нет. */
  readonly providerReference: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Та же заявка глазами клиента — без ссылки на систему провайдера.
 *
 * Номер там служебный: он нужен менеджеру, чтобы свериться с
 * провайдером, а клиенту сказать нечего — обращается он в сервис, а не
 * к провайдеру. На экране карты этот номер к тому же вставал на место
 * имени держателя и читался как её данные, которых у сервиса нет.
 */
export type ClientCardApplicationView = Omit<CardApplicationView, 'providerReference'>;

export interface CardApplicationResult {
  readonly application: CardApplicationView;
  readonly notifications: readonly Notification[];
}

/** Клиентский результат: тот же переход, но без служебного номера. */
export interface ClientCardApplicationResult {
  readonly application: ClientCardApplicationView;
  readonly notifications: readonly Notification[];
}

type CardApplicationRow = typeof cardApplications.$inferSelect;

/** Состояния, в которых заявка ещё не закрыта: карта либо выпущена, либо ждёт. */
const PENDING_STATUSES = cardApplicationStatuses.filter(
  (status) => isCardApplicationOpen(status) || status === 'active',
);

const OPEN_STATUSES = cardApplicationStatuses.filter(isCardApplicationOpen);

function toView(row: CardApplicationRow): CardApplicationView {
  return {
    id: row.id,
    clientId: row.clientId,
    status: row.status,
    providerReference: row.providerReference,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toClientView(row: CardApplicationRow): ClientCardApplicationView {
  const { providerReference: _providerReference, ...rest } = toView(row);
  return rest;
}

function notificationFor(row: CardApplicationRow): Notification {
  return { kind: 'card-application-status', to: row.clientId, status: row.status };
}

/**
 * Подать заявку.
 *
 * Вторая заявка при действующей карте не создаётся — карта у клиента
 * одна. Не создаётся и вторая, пока первая в работе: провайдер получил
 * бы два обращения об одном человеке, а клиент — два разных статуса на
 * один вопрос «где моя карта».
 */
export async function submitCardApplication(
  ctx: CoreConfig,
  actor: Actor,
): Promise<ClientCardApplicationResult> {
  const clientId = requireClient(actor);

  return ctx.db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(cardApplications)
      .where(eq(cardApplications.clientId, clientId))
      .for('update');

    const pending = existing.find((row) => PENDING_STATUSES.includes(row.status));
    if (pending) {
      throw new ConflictError(
        pending.status === 'active'
          ? 'Карта уже выпущена и активна'
          : 'Заявка на карту уже подана и находится в работе',
      );
    }

    const [row] = await tx.insert(cardApplications).values({ clientId }).returning();
    return { application: toClientView(row!), notifications: [notificationFor(row!)] };
  });
}

/**
 * Отозвать собственную заявку.
 *
 * Только пока провайдер за неё не взялся: дальше оформление уже идёт на
 * его стороне, и «отменено» в приложении не остановило бы то, что
 * происходит у него. Отзыв и отказ провайдера — разные исходы и разные
 * состояния: слитые в одно, они не дали бы отличить передумавшего
 * клиента от того, кому не выпустили карту.
 */
export async function cancelOwnCardApplication(
  ctx: CoreConfig,
  actor: Actor,
  applicationId: string,
): Promise<ClientCardApplicationResult> {
  const clientId = requireClient(actor);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(cardApplications)
      .where(eq(cardApplications.id, applicationId))
      .for('update');

    // Чужая заявка не «запрещена», а «не найдена»: отличать одно от
    // другого значило бы подтверждать её существование перебирающему.
    if (!row || row.clientId !== clientId) {
      throw new NotFoundError('Заявка на карту не найдена');
    }
    if (row.status !== 'submitted') {
      throw new TransitionNotAllowedError(
        'Заявку уже взяли в работу — отменить её может только менеджер',
      );
    }

    const [updated] = await tx
      .update(cardApplications)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(cardApplications.id, applicationId))
      .returning();

    return { application: toClientView(updated!), notifications: [notificationFor(updated!)] };
  });
}

export async function listCardApplications(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly ClientCardApplicationView[]> {
  const clientId = requireClient(actor);
  const rows = await ctx.db
    .select()
    .from(cardApplications)
    .where(eq(cardApplications.clientId, clientId))
    .orderBy(desc(cardApplications.createdAt))
    .limit(CLIENT_HISTORY_LIMIT);
  return rows.map(toClientView);
}

/**
 * Та же заявка в очереди менеджера — с ником клиента: в списке из
 * десятка строк «379336096» не отличается от соседнего номера.
 */
export type ManagerCardApplicationView = CardApplicationView & {
  readonly clientUsername: string | null;
};

/** Очередь менеджера: заявки, по которым ещё нужно вести статус. */
export async function listCardApplicationQueue(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly ManagerCardApplicationView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select({ application: cardApplications, username: clients.username })
    .from(cardApplications)
    .innerJoin(clients, eq(clients.telegramUserId, cardApplications.clientId))
    .where(inArray(cardApplications.status, OPEN_STATUSES))
    .orderBy(desc(cardApplications.createdAt));
  return rows.map((row) => ({ ...toView(row.application), clientUsername: row.username }));
}

export interface UpdateCardApplicationInput {
  readonly status: CardApplicationStatus;
  readonly providerReference?: string | undefined;
}

async function lockApplication(
  executor: Executor,
  applicationId: string,
): Promise<CardApplicationRow> {
  const [row] = await executor
    .select()
    .from(cardApplications)
    .where(eq(cardApplications.id, applicationId))
    .limit(1)
    .for('update');
  if (!row) {
    throw new NotFoundError('Заявка на карту не найдена');
  }
  return row;
}

export async function updateCardApplicationStatus(
  ctx: CoreConfig,
  actor: Actor,
  applicationId: string,
  input: UpdateCardApplicationInput,
): Promise<CardApplicationResult> {
  requireStaff(actor);
  const providerReference = input.providerReference?.trim();

  return ctx.db.transaction(async (tx) => {
    const row = await lockApplication(tx, applicationId);
    if (!canTransitionCardApplication(row.status, input.status)) {
      throw new TransitionNotAllowedError(
        `Заявку на карту из состояния «${row.status}» нельзя перевести в «${input.status}»`,
      );
    }

    const [updated] = await tx
      .update(cardApplications)
      .set({
        status: input.status,
        updatedAt: new Date(),
        ...(providerReference ? { providerReference } : {}),
      })
      .where(eq(cardApplications.id, row.id))
      .returning();

    return { application: toView(updated!), notifications: [notificationFor(updated!)] };
  });
}
