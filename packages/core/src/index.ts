import type { Actor } from './actor.js';
import { getClient, registerClient, type RegisterClientInput } from './clients.js';
import { toContext, type CoreConfig } from './context.js';
import {
  getExchangeRequest,
  listCurrencyPairs,
  listExchangeRequests,
  submitExchangeRequest,
  type SubmitExchangeRequestInput,
} from './exchange-requests.js';
import {
  getRequisites,
  saveRequisites,
  type SaveRequisitesInput,
} from './requisites.js';
import { beginStaffLogin, completeStaffLogin, getActiveStaff } from './staff.js';
import {
  cancelExchangeRequest,
  claimExchangeRequest,
  completeExchangeRequest,
  confirmExchangeRate,
  getExchangeRequestForStaff,
  listExchangeRequestEvents,
  listExchangeRequestQueue,
  listExchangeRequestsInProgress,
  markPaymentReceived,
  type CompleteExchangeRequestInput,
  type ConfirmExchangeRateInput,
} from './exchange-workflow.js';

/**
 * Прикладные операции сервиса — единственное место, где меняется его
 * состояние.
 *
 * Оба приложения — тонкие адаптеры: маршрут разбирает запрос, вызывает
 * операцию, отдаёт результат. Ни Mini App, ни админка не пишут в базу
 * напрямую. Иначе правило вроде «баллы начисляются при исполнении
 * заявки» пришлось бы повторять в каждом месте, откуда заявку можно
 * исполнить, и рано или поздно одно из них отстало бы.
 *
 * Интерфейс — операции, а не таблицы: «подать заявку», а не
 * «вставить строку в exchange_requests». Каждая операция принимает
 * данные и того, кто её выполняет, и сама решает, разрешено ли действие.
 */
export function createCore(config: CoreConfig) {
  const ctx = toContext(config);

  return {
    registerClient: (input: RegisterClientInput) => registerClient(ctx, input),
    getClient: (telegramUserId: bigint) => getClient(ctx, telegramUserId),

    listCurrencyPairs: () => listCurrencyPairs(ctx),
    submitExchangeRequest: (actor: Actor, input: SubmitExchangeRequestInput) =>
      submitExchangeRequest(ctx, actor, input),
    listExchangeRequests: (actor: Actor) => listExchangeRequests(ctx, actor),
    getExchangeRequest: (actor: Actor, requestId: string) =>
      getExchangeRequest(ctx, actor, requestId),

    saveRequisites: (actor: Actor, input: SaveRequisitesInput) =>
      saveRequisites(ctx, actor, input),
    getRequisites: (actor: Actor) => getRequisites(ctx, actor),

    cancelExchangeRequest: (actor: Actor, requestId: string, input?: { reason?: string }) =>
      cancelExchangeRequest(ctx, actor, requestId, input),

    listExchangeRequestQueue: (actor: Actor) => listExchangeRequestQueue(ctx, actor),
    listExchangeRequestsInProgress: (actor: Actor) =>
      listExchangeRequestsInProgress(ctx, actor),
    getExchangeRequestForStaff: (actor: Actor, requestId: string) =>
      getExchangeRequestForStaff(ctx, actor, requestId),
    listExchangeRequestEvents: (actor: Actor, requestId: string) =>
      listExchangeRequestEvents(ctx, actor, requestId),
    claimExchangeRequest: (actor: Actor, requestId: string) =>
      claimExchangeRequest(ctx, actor, requestId),
    confirmExchangeRate: (actor: Actor, requestId: string, input: ConfirmExchangeRateInput) =>
      confirmExchangeRate(ctx, actor, requestId, input),
    markPaymentReceived: (actor: Actor, requestId: string) =>
      markPaymentReceived(ctx, actor, requestId),
    completeExchangeRequest: (
      actor: Actor,
      requestId: string,
      input: CompleteExchangeRequestInput,
    ) => completeExchangeRequest(ctx, actor, requestId, input),

    beginStaffLogin: (telegramUserId: bigint) => beginStaffLogin(ctx, telegramUserId),
    completeStaffLogin: (staffId: string, code: string) =>
      completeStaffLogin(ctx, staffId, code),
    getActiveStaff: (staffId: string) => getActiveStaff(ctx, staffId),
  };
}

export type Core = ReturnType<typeof createCore>;

/**
 * Подключение к базе реэкспортируется отсюда, чтобы приложения не
 * зависели от `@nemo/db` вовсе: пакет со схемой — деталь реализации
 * операций, и импорт таблицы в маршруте должен быть заметен как
 * посторонняя зависимость, а не выглядеть обычным делом.
 */
export { createDatabase, type Database } from '@nemo/db';

export type { Actor } from './actor.js';
export type { CoreConfig } from './context.js';
export type {
  ClientView,
  RegisterClientInput,
  RegisterClientResult,
} from './clients.js';
export type {
  CurrencyPairView,
  ExchangeRequestView,
  SubmitExchangeRequestInput,
  SubmitExchangeRequestResult,
} from './exchange-requests.js';
export type { RequisitesView, SaveRequisitesInput } from './requisites.js';
export type { BeginStaffLoginResult, StaffSession } from './staff.js';
export type {
  CompleteExchangeRequestInput,
  ConfirmExchangeRateInput,
  ExchangeRequestEventView,
  ManagerExchangeRequestView,
  TransitionResult,
} from './exchange-workflow.js';
export {
  ConflictError,
  CoreError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  TransitionNotAllowedError,
  type CoreErrorCode,
} from './errors.js';
export { renderNotification, type Notification } from './notifications.js';
