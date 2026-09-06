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
  /** Кто подал: клиент или мерчант (docs/adr/0017). */
  readonly party: ExchangeParty;
  readonly assignedManagerName: string | null;
  readonly createdAt: string;
}

/**
 * Чья заявка — в том виде, в каком её читает строка стола.
 *
 * Размеченным объединением, а не парой необязательных полей: у заявки
 * мерчанта ника нет вовсе, и строка «Без ника · ID» в ней читалась бы
 * как клиент, о котором ничего не известно.
 */
export type ExchangeParty =
  | { readonly kind: 'client'; readonly clientId: string; readonly username: string | null }
  | { readonly kind: 'merchant'; readonly name: string; readonly reference: string | null };

export function toExchangeRow(view: ManagerExchangeRequestView): ExchangeRow {
  return {
    id: view.id,
    kind: view.kind,
    fromAmount: view.fromAmount,
    fromCode: view.fromCode,
    toAmount: view.toAmount,
    toCode: view.toCode,
    status: view.status,
    party: partyOf(view),
    assignedManagerName: view.assignedManagerName,
    createdAt: view.createdAt.toISOString(),
  };
}

/**
 * Кто подал, одной строкой: ник клиента или название мерчанта с его
 * номером сделки. Одна на стол и на палитру — иначе одна и та же заявка
 * называлась бы в двух списках по-разному.
 */
export function sayParty(party: ExchangeParty): string {
  if (party.kind === 'client') {
    return party.username ? `@${party.username}` : party.clientId;
  }
  return party.reference ? `${party.name} · ${party.reference}` : party.name;
}

export function partyOf(view: ManagerExchangeRequestView): ExchangeParty {
  return view.owner.kind === 'client'
    ? {
        kind: 'client',
        clientId: view.owner.clientId.toString(),
        username: view.clientUsername,
      }
    : {
        kind: 'merchant',
        // Мерчант из заявки не пропадает: на него ссылается строка, и
        // удалить его база не даст. Пустое имя означало бы сломанную
        // ссылку, и молчать об этом в столе нельзя.
        name: view.merchantName ?? 'мерчант удалён',
        reference: view.reference,
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
  /**
   * Только заявки одного мерчанта. Живёт в адресе, как и остальные
   * сужения: из карточки мерчанта в стол переходят ссылкой, и ссылка
   * эта должна работать у коллеги.
   */
  readonly merchant: string;
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
    ...(filter.merchant ? { merchantId: filter.merchant } : {}),
  };
  if (scope === 'queue') return common;
  return {
    ...common,
    ...(filter.status ? { status: filter.status as ExchangeRequestStatus } : {}),
    mine: scope === 'mine',
  };
}
