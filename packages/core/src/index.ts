import type { StaffRole } from '@nemo/types';
import type { Actor } from './actor.js';
import {
  addStaff,
  enrollFirstAdmin,
  getServiceSettings,
  listSettingsAuditLog,
  listStaff,
  reissueSecondFactorFromConsole,
  resetStaffSecondFactor,
  setStaffActive,
  updateServiceSettings,
  updateStaffRole,
  type AddStaffInput,
  type UpdateServiceSettingsInput,
} from './admin.js';
import { getBonusAccount } from './bonus-account.js';
import {
  finishBroadcast,
  listBroadcasts,
  recordBroadcastProgress,
  setMarketingConsent,
  startBroadcast,
  type BroadcastProgress,
} from './broadcasts.js';
import {
  listCardApplicationQueue,
  cancelOwnCardApplication,
  listCardApplications,
  submitCardApplication,
  updateCardApplicationStatus,
  type UpdateCardApplicationInput,
} from './card-applications.js';
import {
  getClient,
  getClientCard,
  registerClient,
  type RegisterClientInput,
} from './clients.js';
import type { CoreConfig } from './context.js';
import {
  expireUnpaidExchangeRequests,
  warnAboutExpiringExchangeRequests,
} from './expiry.js';
import {
  getExchangeRequest,
  getExchangeTerms,
  listExchangeRequests,
  submitExchangeRequest,
  type SubmitExchangeRequestInput,
} from './exchange-requests.js';
import { getClientHistory } from './history-feed.js';
import { listDirections, setDirectionActive } from './directions.js';
import {
  listFeeSchedules,
  saveFeeSchedule,
  setFeeScheduleActive,
  type SaveFeeScheduleInput,
} from './fee-schedules.js';
import {
  listActiveNetworks,
  listNetworks,
  setNetworkActive,
} from './networks.js';
import { pingDatabase } from './health.js';
import { getQuote, type QuoteInput } from './rates.js';
import { getServiceMarkupBps } from './settings.js';
import { submitInquiry, type SubmitInquiryInput } from './inquiries.js';
import {
  countUnansweredConversations,
  listConversation,
  listConversations,
  receiveClientMessage,
  replyToClient,
  type ConversationFilter,
  type ReceiveMessageInput,
  type ReplyInput,
} from './conversations.js';
import { takeStaffAlerts } from './staff-alerts.js';
import {
  answerAsConcierge,
  handOverToHuman,
  listConversationsAwaitingConcierge,
  returnToConcierge,
  type AnswerAsConciergeInput,
} from './concierge.js';
import {
  listKnowledgeArticles,
  saveKnowledgeArticle,
  setKnowledgeArticleActive,
  type SaveKnowledgeArticleInput,
} from './concierge-knowledge.js';
import {
  listRequisiteAccessLog,
  revealMessageAttachment,
  revealRequisites,
  type RequisiteAccessFilter,
} from './requisite-access.js';
import {
  archiveRequisites,
  listRequisites,
  saveRequisites,
  type SaveRequisitesInput,
} from './requisites.js';
import {
  addServiceAccount,
  listServiceAccounts,
  setServiceAccountActive,
  updateServiceAccount,
  type SaveServiceAccountInput,
  type ServiceAccountFilter,
} from './service-accounts.js';
import { botText, type BotTextKey } from './bot-texts.js';
import {
  beginStaffLogin,
  claimSecondFactor,
  completeStaffLogin,
  getActiveStaff,
} from './staff.js';
import {
  approveWithdrawalRequest,
  listWithdrawalQueue,
  listWithdrawalRequests,
  markWithdrawalPaid,
  rejectWithdrawalRequest,
  revealWithdrawalDestination,
  submitWithdrawalRequest,
  type SubmitWithdrawalInput,
} from './withdrawals.js';
import {
  cancelExchangeRequest,
  cancelOwnExchangeRequest,
  claimExchangeRequest,
  completeExchangeRequest,
  countExchangeRequestQueue,
  countExchangeRequestsInProgress,
  confirmExchangeRate,
  isRequestPricedBySchedule,
  getExchangeRequestForStaff,
  listExchangeRequestEvents,
  listExchangeRequestQueue,
  listExchangeRequestsInProgress,
  markPaymentReceived,
  type CompleteExchangeRequestInput,
  type ConfirmExchangeRateInput,
  type ExchangeQueueFilter,
} from './exchange-workflow.js';
import { listColleagues, reassignExchangeRequest } from './exchange-reassign.js';
import { summarizeReferrals } from './referral-summary.js';
export type { ReferralLineTotal, ReferralSummary, ReferralTopClient } from './referral-summary.js';
import {
  countClients,
  listClientExchangeRequests,
  listClients,
  summarizeClients,
  type ClientFilter,
} from './clients-directory.js';
export type {
  ClientFilter,
  ClientRow,
  ClientTab,
  ClientsSummary,
} from './clients-directory.js';
export { REGULAR_CLIENT_COMPLETED } from './clients-directory.js';
import {
  breakdownExchangeRequests,
  countExchangeRequestsFor,
  summarizeExchangeRequests,
  type AnalyticsPeriod,
} from './analytics.js';
export type {
  AnalyticsPeriod,
  DayBreakdown,
  ExchangeBreakdowns,
  ManagerBreakdown,
  ExchangeAnalytics,
  ExchangeCounts,
  ExchangeSummary,
  MoneyByCurrency,
} from './analytics.js';
export type { ColleagueView, ReassignExchangeRequestInput } from './exchange-reassign.js';
import type { ReassignExchangeRequestInput } from './exchange-reassign.js';

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
 * Исключение — вход сотрудника: эти операции исполнителя не принимают,
 * потому что как раз его и устанавливают.
 *
 * Список ниже перечисляет операции руками, хотя каждая строка только
 * подставляет `ctx`. Собрать его обобщённой функцией можно, но тогда
 * единственное место, где видно, что ядро вообще умеет, перестанет
 * читаться глазами — а сюда приходят именно за этим.
 */
export function createCore(ctx: CoreConfig) {
  return {
    registerClient: (input: RegisterClientInput) => registerClient(ctx, input),
    getClient: (actor: Actor) => getClient(ctx, actor),
    /** Карточка клиента для сотрудника: с кем идёт разговор. */
    getClientCard: (actor: Actor, clientId: bigint) => getClientCard(ctx, actor, clientId),

    getExchangeTerms: () => getExchangeTerms(ctx),
    getQuote: (input: QuoteInput) => getQuote(ctx, input),
    submitExchangeRequest: (actor: Actor, input: SubmitExchangeRequestInput) =>
      submitExchangeRequest(ctx, actor, input),
    listExchangeRequests: (actor: Actor) => listExchangeRequests(ctx, actor),
    getClientHistory: (actor: Actor) => getClientHistory(ctx, actor),
    getExchangeRequest: (actor: Actor, requestId: string) =>
      getExchangeRequest(ctx, actor, requestId),

    saveRequisites: (actor: Actor, input: SaveRequisitesInput) =>
      saveRequisites(ctx, actor, input),
    listRequisites: (actor: Actor) => listRequisites(ctx, actor),
    archiveRequisites: (actor: Actor, requisitesId: string) =>
      archiveRequisites(ctx, actor, requisitesId),
    // Без исполнителя: сети нужны и клиенту в форме реквизитов, и
    // менеджеру в панели, и секрета в списке нет.
    listActiveNetworks: () => listActiveNetworks(ctx),
    /** Пульс базы для `/api/health`; о содержимом не говорит ничего. */
    pingDatabase: () => pingDatabase(ctx),

    setMarketingConsent: (actor: Actor, consent: boolean) =>
      setMarketingConsent(ctx, actor, consent),

    getBonusAccount: (actor: Actor) => getBonusAccount(ctx, actor),
    submitWithdrawalRequest: (actor: Actor, input: SubmitWithdrawalInput) =>
      submitWithdrawalRequest(ctx, actor, input),
    listWithdrawalRequests: (actor: Actor) => listWithdrawalRequests(ctx, actor),
    listWithdrawalQueue: (actor: Actor) => listWithdrawalQueue(ctx, actor),
    approveWithdrawalRequest: (actor: Actor, requestId: string) =>
      approveWithdrawalRequest(ctx, actor, requestId),
    markWithdrawalPaid: (actor: Actor, requestId: string) =>
      markWithdrawalPaid(ctx, actor, requestId),
    rejectWithdrawalRequest: (actor: Actor, requestId: string, input?: { reason?: string }) =>
      rejectWithdrawalRequest(ctx, actor, requestId, input),
    revealWithdrawalDestination: (actor: Actor, requestId: string) =>
      revealWithdrawalDestination(ctx, actor, requestId),

    submitCardApplication: (actor: Actor) => submitCardApplication(ctx, actor),
    listCardApplications: (actor: Actor) => listCardApplications(ctx, actor),
    cancelOwnCardApplication: (actor: Actor, applicationId: string) =>
      cancelOwnCardApplication(ctx, actor, applicationId),
    listCardApplicationQueue: (actor: Actor) => listCardApplicationQueue(ctx, actor),
    updateCardApplicationStatus: (
      actor: Actor,
      applicationId: string,
      input: UpdateCardApplicationInput,
    ) => updateCardApplicationStatus(ctx, actor, applicationId, input),

    cancelOwnExchangeRequest: (actor: Actor, requestId: string) =>
      cancelOwnExchangeRequest(ctx, actor, requestId),
    cancelExchangeRequest: (actor: Actor, requestId: string, input?: { reason?: string }) =>
      cancelExchangeRequest(ctx, actor, requestId, input),

    /*
     * Истечение срока оплаты. Без актора: действует система, а момент
     * передаётся параметром — планировщик и тест вызывают одно и то же.
     */
    warnAboutExpiringExchangeRequests: (at: Date) =>
      warnAboutExpiringExchangeRequests(ctx, at),
    expireUnpaidExchangeRequests: (at: Date) => expireUnpaidExchangeRequests(ctx, at),

    listExchangeRequestQueue: (actor: Actor, filter?: ExchangeQueueFilter) =>
      listExchangeRequestQueue(ctx, actor, filter),
    /*
     * Счётчики — отдельным запросом, а не длиной выборки: у выборки
     * есть предел, и счётчик по ней врал бы ровно тогда, когда его
     * читают чаще всего.
     */
    countExchangeRequestQueue: (actor: Actor, filter?: ExchangeQueueFilter) =>
      countExchangeRequestQueue(ctx, actor, filter),
    countExchangeRequestsInProgress: (actor: Actor, filter?: ExchangeQueueFilter) =>
      countExchangeRequestsInProgress(ctx, actor, filter),
    listExchangeRequestsInProgress: (actor: Actor, filter?: ExchangeQueueFilter) =>
      listExchangeRequestsInProgress(ctx, actor, filter),
    getExchangeRequestForStaff: (actor: Actor, requestId: string) =>
      getExchangeRequestForStaff(ctx, actor, requestId),
    listExchangeRequestEvents: (actor: Actor, requestId: string) =>
      listExchangeRequestEvents(ctx, actor, requestId),
    claimExchangeRequest: (actor: Actor, requestId: string) =>
      claimExchangeRequest(ctx, actor, requestId),
    reassignExchangeRequest: (
      actor: Actor,
      requestId: string,
      input: ReassignExchangeRequestInput,
    ) => reassignExchangeRequest(ctx, actor, requestId, input),
    listColleagues: (actor: Actor) => listColleagues(ctx, actor),
    summarizeReferrals: (actor: Actor, period: AnalyticsPeriod) =>
      summarizeReferrals(ctx, actor, period),
    listClients: (actor: Actor, filter?: ClientFilter) => listClients(ctx, actor, filter),
    countClients: (actor: Actor, filter?: ClientFilter) => countClients(ctx, actor, filter),
    summarizeClients: (actor: Actor) => summarizeClients(ctx, actor),
    listClientExchangeRequests: (
      actor: Actor,
      clientId: bigint,
      options?: {
        limit?: number | undefined;
        after?: { createdAt: Date; id: string } | undefined;
      },
    ) => listClientExchangeRequests(ctx, actor, clientId, options),
    countExchangeRequestsFor: (actor: Actor, period: AnalyticsPeriod) =>
      countExchangeRequestsFor(ctx, actor, period),
    summarizeExchangeRequests: (actor: Actor, period: AnalyticsPeriod) =>
      summarizeExchangeRequests(ctx, actor, period),
    breakdownExchangeRequests: (
      actor: Actor,
      period: AnalyticsPeriod,
      options?: { offsetMinutes?: number | undefined },
    ) => breakdownExchangeRequests(ctx, actor, period, options),
    confirmExchangeRate: (actor: Actor, requestId: string, input: ConfirmExchangeRateInput) =>
      confirmExchangeRate(ctx, actor, requestId, input),
    /*
     * Считается ли цена этой заявки сеткой ступеней. Нужно подсказке
     * дохода: там, где курс пришёл от сетки, наценки в нём нет, и
     * посчитанное по ней число было бы выдумкой.
     */
    isRequestPricedBySchedule: (actor: Actor, requestId: string) =>
      isRequestPricedBySchedule(ctx, actor, requestId),
    markPaymentReceived: (actor: Actor, requestId: string) =>
      markPaymentReceived(ctx, actor, requestId),
    completeExchangeRequest: (
      actor: Actor,
      requestId: string,
      input: CompleteExchangeRequestInput,
    ) => completeExchangeRequest(ctx, actor, requestId, input),

    /*
     * Счета сервиса (docs/adr/0008). Список нужен и менеджеру — из
     * него он выбирает, что выдать клиенту, — а ведёт его
     * администратор: счёт это решение о том, куда сервис принимает
     * деньги.
     */
    listServiceAccounts: (actor: Actor, filter?: ServiceAccountFilter) =>
      listServiceAccounts(ctx, actor, filter),
    addServiceAccount: (actor: Actor, input: SaveServiceAccountInput) =>
      addServiceAccount(ctx, actor, input),
    updateServiceAccount: (actor: Actor, accountId: string, input: SaveServiceAccountInput) =>
      updateServiceAccount(ctx, actor, accountId, input),
    setServiceAccountActive: (actor: Actor, accountId: string, isActive: boolean) =>
      setServiceAccountActive(ctx, actor, accountId, isActive),

    revealRequisites: (actor: Actor, exchangeRequestId: string) =>
      revealRequisites(ctx, actor, exchangeRequestId),
    revealMessageAttachment: (actor: Actor, messageId: string) =>
      revealMessageAttachment(ctx, actor, messageId),

    // Приём сообщения — без актора: клиента подтверждает подпись
    // вебхука Telegram, и он же им и является.
    receiveClientMessage: (input: ReceiveMessageInput) => receiveClientMessage(ctx, input),
    // Просьба оплатить за границей — тоже обращение, но собранное
    // приложением: клиент выбирает тему и описывает, что оплатить.
    submitInquiry: (input: SubmitInquiryInput) => submitInquiry(ctx, input),
    replyToClient: (actor: Actor, input: ReplyInput) => replyToClient(ctx, actor, input),
    listConversation: (actor: Actor, clientId: bigint) =>
      listConversation(ctx, actor, clientId),
    listConversations: (actor: Actor, filter?: ConversationFilter) =>
      listConversations(ctx, actor, filter),
    countUnansweredConversations: (actor: Actor) => countUnansweredConversations(ctx, actor),
    takeStaffAlerts: (at: Date) => takeStaffAlerts(ctx, at),

    answerAsConcierge: (input: AnswerAsConciergeInput) => answerAsConcierge(ctx, input),
    listConversationsAwaitingConcierge: () => listConversationsAwaitingConcierge(ctx),
    handOverToHuman: (actor: Actor, clientId: bigint) =>
      handOverToHuman(ctx, actor, clientId),
    returnToConcierge: (actor: Actor, clientId: bigint) =>
      returnToConcierge(ctx, actor, clientId),
    listKnowledgeArticles: (actor: Actor) => listKnowledgeArticles(ctx, actor),
    saveKnowledgeArticle: (actor: Actor, input: SaveKnowledgeArticleInput) =>
      saveKnowledgeArticle(ctx, actor, input),
    setKnowledgeArticleActive: (actor: Actor, id: string, isActive: boolean) =>
      setKnowledgeArticleActive(ctx, actor, id, isActive),
    listRequisiteAccessLog: (actor: Actor, filter?: RequisiteAccessFilter) =>
      listRequisiteAccessLog(ctx, actor, filter),

    beginStaffLogin: (telegramUserId: bigint) => beginStaffLogin(ctx, telegramUserId),
    // Только после проверенной подписи Telegram Login — см. `staff.ts`.
    claimSecondFactor: (staffId: string) => claimSecondFactor(ctx, staffId),
    completeStaffLogin: (staffId: string, code: string) =>
      completeStaffLogin(ctx, staffId, code),
    getActiveStaff: (staffId: string) => getActiveStaff(ctx, staffId),
    enrollFirstAdmin: (input: { telegramUserId: bigint; displayName: string }) =>
      enrollFirstAdmin(ctx, input),
    // Без актора и только из скрипта развёртывания — см. `admin.ts`.
    reissueSecondFactorFromConsole: (telegramUserId: bigint) =>
      reissueSecondFactorFromConsole(ctx, telegramUserId),

    listStaff: (actor: Actor) => listStaff(ctx, actor),
    addStaff: (actor: Actor, input: AddStaffInput) => addStaff(ctx, actor, input),
    updateStaffRole: (actor: Actor, staffId: string, role: StaffRole) =>
      updateStaffRole(ctx, actor, staffId, role),
    setStaffActive: (actor: Actor, staffId: string, isActive: boolean) =>
      setStaffActive(ctx, actor, staffId, isActive),
    resetStaffSecondFactor: (actor: Actor, staffId: string) =>
      resetStaffSecondFactor(ctx, actor, staffId),

    getServiceSettings: (actor: Actor) => getServiceSettings(ctx, actor),
    /** Наценка — сотруднику: по ней панель подсказывает доход по заявке. */
    getServiceMarkupBps: (actor: Actor) => getServiceMarkupBps(ctx, actor),
    updateServiceSettings: (actor: Actor, input: UpdateServiceSettingsInput) =>
      updateServiceSettings(ctx, actor, input),
    listSettingsAuditLog: (actor: Actor, limit?: number) =>
      listSettingsAuditLog(ctx, actor, limit),

    listNetworks: (actor: Actor) => listNetworks(ctx, actor),

    /** Текст, которым бот говорит с клиентом. Лежит в коде, а не в базе. */
    getBotText: (key: BotTextKey) => botText(key),
    setNetworkActive: (actor: Actor, code: string, isActive: boolean) =>
      setNetworkActive(ctx, actor, code, isActive),

    listDirections: (actor: Actor) => listDirections(ctx, actor),
    setDirectionActive: (actor: Actor, directionId: string, isActive: boolean) =>
      setDirectionActive(ctx, actor, directionId, isActive),

    /*
     * Ставки комиссии по ступеням. Заводит и правит их администратор:
     * цена обмена — решение о деньгах, и держать её в коде значило бы
     * менять проценты выкаткой.
     */
    listFeeSchedules: (actor: Actor) => listFeeSchedules(ctx, actor),
    saveFeeSchedule: (actor: Actor, input: SaveFeeScheduleInput) =>
      saveFeeSchedule(ctx, actor, input),
    setFeeScheduleActive: (actor: Actor, scheduleId: string, isActive: boolean) =>
      setFeeScheduleActive(ctx, actor, scheduleId, isActive),

    /*
     * Текст заготовки без исполнителя: его читает бот, чтобы показать
     * клиенту, и права здесь спрашивать не у кого.
     */

    startBroadcast: (actor: Actor, input: { body: string }) =>
      startBroadcast(ctx, actor, input),
    recordBroadcastProgress: (
      actor: Actor,
      broadcastId: string,
      progress: BroadcastProgress,
    ) => recordBroadcastProgress(ctx, actor, broadcastId, progress),
    finishBroadcast: (actor: Actor, broadcastId: string, result: BroadcastProgress) =>
      finishBroadcast(ctx, actor, broadcastId, result),
    listBroadcasts: (actor: Actor, limit?: number) => listBroadcasts(ctx, actor, limit),
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
  ClientCardView,
  ClientView,
  RegisterClientInput,
  RegisterClientResult,
} from './clients.js';
export type {
  CurrencyPairView,
  ExchangeRequestView,
  ExchangeTermsView,
  SubmitExchangeRequestInput,
  SubmitExchangeRequestResult,
} from './exchange-requests.js';
export { inquiryTopics, isInquiryTopic } from './inquiries.js';
export type { InquiryTopic, SubmitInquiryInput } from './inquiries.js';
export type { RequisitesView, SaveRequisitesInput } from './requisites.js';
/*
 * Подпись записи — наружу, чтобы тест клиентского приложения сверил с
 * ней свою копию: в браузер ядро не идёт, а расходиться копии не должны.
 */
export { describeRequisites } from './requisites.js';
export type {
  SaveServiceAccountInput,
  ServiceAccountFields,
  ServiceAccountFilter,
  ServiceAccountView,
} from './service-accounts.js';
export type { NetworkView } from './networks.js';
export type { DirectionView } from './directions.js';
export type { FeeScheduleView, SaveFeeScheduleInput } from './fee-schedules.js';
export {
  botTextKeys,
  BOT_TEXTS,
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
} from './bot-texts.js';
export type { BotTextKey } from './bot-texts.js';
export { slopComplaints } from './bot-slop.js';
export type { BonusAccountView, BonusTransactionView } from './bonus-account.js';
export type { ClientHistoryEntry, ClientHistoryView } from './history-feed.js';
export type { ServiceSettingsView } from './settings.js';
export type { QuoteInput, QuoteView, RatePair, RateQuote, RateSource } from './rates.js';
export type {
  ManagerWithdrawalView,
  SubmitWithdrawalInput,
  WithdrawalRequestView,
  WithdrawalTransitionResult,
} from './withdrawals.js';
export type {
  CardApplicationResult,
  CardApplicationView,
  ClientCardApplicationView,
  ManagerCardApplicationView,
  UpdateCardApplicationInput,
} from './card-applications.js';
export type {
  RequisiteAccessEntry,
  RequisiteAccessFilter,
  RevealedRequisites,
} from './requisite-access.js';
export type {
  ConversationFilter,
  ConversationTopicFilter,
  ConversationView,
  MessageView,
  ReceiveMessageInput,
  ReplyInput,
} from './conversations.js';
export type { BroadcastProgress, BroadcastView, StartedBroadcast } from './broadcasts.js';
export type { SecondFactorEnrollment, StaffLoginStart, StaffSession } from './staff.js';
export type {
  AddStaffInput,
  SettingsAuditEntry,
  StaffEnrollment,
  StaffView,
  UpdateServiceSettingsInput,
} from './admin.js';
export type {
  ClientTransitionResult,
  CompleteExchangeRequestInput,
  ConfirmExchangeRateInput,
  ExchangeQueueFilter,
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
export {
  renderNotification,
  type NewRequestSubject,
  type Notification,
} from './notifications.js';
export type {
  ConciergeAnswer,
  ConciergeHintKey,
  ConciergeRequest,
  ConciergeSource,
  ConciergeTurn,
} from './concierge-source.js';
export {
  CONCIERGE_GREETING,
  CONCIERGE_HANDOVER,
  CONCIERGE_HELLO,
  CONCIERGE_HINTS,
  CONCIERGE_INSTRUCTIONS,
  CONCIERGE_OFFTOPIC,
  isGreetingOnly,
} from './concierge-voice.js';
export { CONCIERGE_QUIET_MS } from './concierge.js';
export { MAX_REPLY_LENGTH, TIME_UNIT, replyComplaints } from './concierge-guard.js';
export type {
  KnowledgeArticleView,
  SaveKnowledgeArticleInput,
} from './concierge-knowledge.js';
