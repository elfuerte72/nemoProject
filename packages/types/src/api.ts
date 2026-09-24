/**
 * API мерчанта и вебхуки — то, что делят ядро, кабинет и панель: имена
 * событий, состояния доставок и точек, их слова, граница успеха ответа.
 *
 * Здесь, а не в `@nemo/core`, потому что это читают клиентские
 * компоненты кабинета: ядро с `node:crypto` в браузер не собирается,
 * а список событий формы должен быть тем же, что у операции.
 */

import type { ExchangeRequestStatus } from './domain.js';

/**
 * События, о которых мерчант просит сообщать вебхуком: переходы заявки
 * и пробное `ping` из кабинета. «Взята в работу» события не порождает —
 * для мерчанта это ещё ничего не значит.
 */
export const webhookEvents = [
  'exchange_request.created',
  'exchange_request.rate_confirmed',
  'exchange_request.payment_received',
  'exchange_request.completed',
  'exchange_request.cancelled',
  'ping',
] as const;
export type WebhookEvent = (typeof webhookEvents)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (webhookEvents as readonly string[]).includes(value);
}

/**
 * Событие перехода. «Взята в работу» — не событие: для мерчанта оно
 * ничего не значит.
 *
 * Здесь, а не в ядре, с 21 сентября 2026: тем же правилом карточка
 * заявки в кабинете кладёт доставку под свою смену состояния, а ядро с
 * `node:crypto` на экран не собирается. Копия правила на экране
 * разошлась бы с очередью на первом новом состоянии — доставка встала
 * бы не под тот переход.
 */
export function webhookEventForStatus(status: ExchangeRequestStatus): WebhookEvent | undefined {
  switch (status) {
    case 'new':
      return 'exchange_request.created';
    case 'rate_confirmed':
      return 'exchange_request.rate_confirmed';
    case 'payment_received':
      return 'exchange_request.payment_received';
    case 'completed':
      return 'exchange_request.completed';
    case 'cancelled':
      return 'exchange_request.cancelled';
    case 'in_progress':
      return undefined;
  }
}

/** События словами — для чекбоксов, пилюль и карточки в панели. */
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'exchange_request.created': 'заявка принята',
  'exchange_request.rate_confirmed': 'курс подтверждён, ждём оплату',
  'exchange_request.payment_received': 'оплата получена',
  'exchange_request.completed': 'исполнена',
  'exchange_request.cancelled': 'отменена',
  ping: 'пробное',
};

export const webhookDeliveryStatuses = ['pending', 'delivered', 'failed'] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatuses)[number];

export const WEBHOOK_DELIVERY_STATUS_LABELS: Record<WebhookDeliveryStatus, string> = {
  pending: 'Ждёт',
  delivered: 'Доставлено',
  failed: 'Не доставлено',
};

/**
 * Состояние точки — одно из трёх, и решает его ядро: отметка «не
 * отвечает» старше паузы, потому что о ней надо узнать даже у точки,
 * которую поставили на паузу после провала.
 */
export const webhookEndpointStates = ['active', 'paused', 'failing'] as const;
export type WebhookEndpointState = (typeof webhookEndpointStates)[number];

export const WEBHOOK_ENDPOINT_STATE_LABELS: Record<WebhookEndpointState, string> = {
  active: 'Действует',
  paused: 'На паузе',
  failing: 'Не отвечает',
};

/**
 * Ответ короче 400 — успех: граница та же, что у HTTP. Одним правилом
 * для плиток журнала вызовов в ядре и для строк на экране.
 */
export function isFailedApiStatus(status: number): boolean {
  return status >= 400;
}

/**
 * Методы, которые принимает API мерчанта, — ими же сужается журнал
 * вызовов. Здесь, а не в ядре: список читает и фильтр на экране, а
 * клиентскому коду ядро с драйвером базы не везут.
 */
export const API_LOG_METHODS = ['GET', 'POST', 'DELETE'] as const;
export type ApiLogMethod = (typeof API_LOG_METHODS)[number];
