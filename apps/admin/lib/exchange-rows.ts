import type { ExchangeQueueFilter, ManagerExchangeRequestView } from '@nemo/core';
import type { ExchangeKind, ExchangeRequestStatus } from '@nemo/types';

/**
 * Строка очереди, какой она едет в клиентский компонент.
 *
 * `bigint` и `Date` сериализация серверных компонентов не переносит —
 * идентификатор клиента и время подачи едут строками. Тот же вид
 * отдаёт и маршрут дочитывания: у страницы и у него один язык.
 */
export interface ExchangeRow {
  readonly id: string;
  readonly kind: ExchangeKind;
  readonly fromAmount: string;
  readonly fromCode: string;
  readonly toAmount: string | null;
  readonly toCode: string;
  readonly status: ExchangeRequestStatus;
  readonly clientId: string;
  readonly clientUsername: string | null;
  readonly assignedManagerName: string | null;
  readonly createdAt: string;
}

export function toExchangeRow(view: ManagerExchangeRequestView): ExchangeRow {
  return {
    id: view.id,
    kind: view.kind,
    fromAmount: view.fromAmount,
    fromCode: view.fromCode,
    toAmount: view.toAmount,
    toCode: view.toCode,
    status: view.status,
    clientId: view.clientId.toString(),
    clientUsername: view.clientUsername,
    assignedManagerName: view.assignedManagerName,
    createdAt: view.createdAt.toISOString(),
  };
}

/** Три раздела стола — три выборки. Ключ уходит в адрес дочитывания. */
export type DeskScope = 'mine' | 'queue' | 'others';

export const deskScopes: readonly DeskScope[] = ['mine', 'queue', 'others'];

/** Сужение стола в том виде, в каком оно живёт в адресе. */
export interface DeskFilter {
  readonly q: string;
  readonly kind: string;
  readonly status: string;
}

/**
 * Фильтр ядра для раздела стола. Состояние касается только заявок в
 * работе: у очереди оно одно на все строки, и «новая» там не фильтр, а
 * определение.
 */
export function coreFilterFor(scope: DeskScope, filter: DeskFilter): ExchangeQueueFilter {
  const common: ExchangeQueueFilter = {
    ...(filter.q ? { query: filter.q } : {}),
    ...(filter.kind ? { kind: filter.kind as ExchangeKind } : {}),
  };
  if (scope === 'queue') return common;
  return {
    ...common,
    ...(filter.status ? { status: filter.status as ExchangeRequestStatus } : {}),
    mine: scope === 'mine',
  };
}
