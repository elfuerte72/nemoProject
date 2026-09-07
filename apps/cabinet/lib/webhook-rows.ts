import type { WebhookDeliveryView, WebhookEndpointView } from '@nemo/core';
import {
  WEBHOOK_EVENT_LABELS,
  type WebhookDeliveryStatus,
  type WebhookEndpointState,
  type WebhookEvent,
} from '@nemo/types';

/**
 * Точки и доставки для экрана — датами-строками: списки живут в
 * клиентском компоненте, и `Date` через его границу не переезжает.
 */
export interface EndpointRow {
  readonly id: string;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  readonly pausedAt: string | null;
  readonly failingSince: string | null;
  readonly state: WebhookEndpointState;
  readonly createdAt: string;
  readonly deliveries: number;
  readonly lastDelivery: { readonly at: string; readonly status: WebhookDeliveryStatus } | null;
}

export function toEndpointRow(endpoint: WebhookEndpointView): EndpointRow {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    pausedAt: endpoint.pausedAt?.toISOString() ?? null,
    failingSince: endpoint.failingSince?.toISOString() ?? null,
    state: endpoint.state,
    createdAt: endpoint.createdAt.toISOString(),
    deliveries: endpoint.deliveries,
    lastDelivery: endpoint.lastDelivery
      ? { at: endpoint.lastDelivery.at.toISOString(), status: endpoint.lastDelivery.status }
      : null,
  };
}

export interface DeliveryRow {
  readonly id: string;
  readonly endpointUrl: string;
  readonly event: WebhookEvent;
  readonly requestId: string | null;
  readonly status: WebhookDeliveryStatus;
  readonly attempt: number;
  readonly nextAttemptAt: string;
  readonly responseStatus: number | null;
  readonly responseBody: string | null;
  readonly durationMs: number | null;
  readonly error: string | null;
  readonly createdAt: string;
}

export function toDeliveryRow(delivery: WebhookDeliveryView): DeliveryRow {
  return {
    id: delivery.id,
    endpointUrl: delivery.endpointUrl,
    event: delivery.event,
    requestId: delivery.requestId,
    status: delivery.status,
    attempt: delivery.attempt,
    nextAttemptAt: delivery.nextAttemptAt.toISOString(),
    responseStatus: delivery.responseStatus,
    responseBody: delivery.responseBody,
    durationMs: delivery.durationMs,
    error: delivery.error,
    createdAt: delivery.createdAt.toISOString(),
  };
}

/**
 * На что можно подписаться: всё, кроме пробного, — его шлют кнопкой.
 * Порядок — порядок жизни заявки, как в `WEBHOOK_EVENT_LABELS`.
 */
export const SUBSCRIBABLE_EVENTS: readonly WebhookEvent[] = (
  Object.keys(WEBHOOK_EVENT_LABELS) as WebhookEvent[]
).filter((one) => one !== 'ping');

export const DELIVERY_STATUS_TONES: Record<WebhookDeliveryStatus, 'wait' | 'done' | 'off'> = {
  pending: 'wait',
  delivered: 'done',
  failed: 'off',
};
