import type { ExchangeRequestView, RequisitesView } from '@nemo/core';

/**
 * Что мерчант видит в ответах API.
 *
 * Свой вид, а не `ExchangeRequestView` как есть: договор с чужой
 * системой живёт дольше полей ядра, и переименование внутри не должно
 * ломать интеграции. Владельца здесь нет — он и так известен, — а
 * суммы собраны парами «валюта и сумма», как их читают. Деньги
 * строками, время — ISO.
 */

export interface ApiMoney {
  readonly currency: string;
  readonly amount: string | null;
}

export interface ApiExchangeRequest {
  readonly id: string;
  readonly status: ExchangeRequestView['status'];
  readonly from: ApiMoney;
  readonly to: ApiMoney;
  /** Курс заявки — обязательство сервиса; пусто, пока его не назвал менеджер. */
  readonly rate: string | null;
  readonly reference: string | null;
  readonly requisitesId: string | null;
  /** Куда платить. Появляется в состоянии «курс подтверждён». */
  readonly paymentInstructions: string | null;
  /** До какого момента ждут оплату; пусто, пока реквизиты не выданы. */
  readonly payBefore: string | null;
  readonly cancelReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export function toApiRequest(
  request: ExchangeRequestView,
  terms: { readonly unpaidTtlMinutes: number },
): ApiExchangeRequest {
  const rate = request.finalRate ?? request.requestRate;
  const payBefore =
    request.requisitesIssuedAt && request.status === 'rate_confirmed'
      ? new Date(request.requisitesIssuedAt.getTime() + terms.unpaidTtlMinutes * 60_000)
      : null;

  return {
    id: request.id,
    status: request.status,
    from: { currency: request.fromCode, amount: request.fromAmount },
    to: { currency: request.toCode, amount: request.toAmount },
    rate,
    reference: request.reference,
    requisitesId: request.requisitesId,
    paymentInstructions: request.paymentInstructions,
    payBefore: payBefore?.toISOString() ?? null,
    cancelReason: request.cancelReason,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
  };
}

/** Запись получателя: то же, что видит клиент, — хвосты, а не номера. */
export interface ApiRequisites {
  readonly id: string;
  readonly kind: RequisitesView['kind'];
  readonly bankName: string | null;
  readonly phone: string | null;
  readonly cardLast4: string | null;
  readonly network: string | null;
  readonly addressHint: string | null;
  readonly holderName: string | null;
  readonly accountLast4: string | null;
  readonly qrHint: string | null;
  readonly alipayAccount: string | null;
  readonly isAvailable: boolean;
  readonly createdAt: string;
}

export function toApiRequisites(view: RequisitesView): ApiRequisites {
  return {
    id: view.id,
    kind: view.kind,
    bankName: view.bankName,
    phone: view.phone,
    cardLast4: view.cardLast4,
    network: view.network,
    addressHint: view.addressHint,
    holderName: view.holderName,
    accountLast4: view.accountLast4,
    qrHint: view.qrHint,
    alipayAccount: view.alipayAccount,
    isAvailable: view.isAvailable,
    createdAt: view.createdAt.toISOString(),
  };
}

/** Страница списка: строки и курсор на следующую, если она может быть. */
export function page<T extends { readonly createdAt: string; readonly id: string }>(
  items: readonly T[],
  limit: number,
): { items: readonly T[]; nextCursor: { after: string; afterId: string } | null } {
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      items.length === limit && last ? { after: last.createdAt, afterId: last.id } : null,
  };
}
