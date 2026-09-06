import type { MerchantView, Owner } from '@nemo/core';
import type { MerchantCardData } from '@/app/ui/merchant-card';

/**
 * Мерчант из ядра — в вид, который переживает границу сервера.
 *
 * По образцу `toClientCardData` и по той же причине: `Date` в
 * клиентский компонент не переезжает, а карточка стоит на двух экранах
 * — заявка и сам мерчант.
 */
export function toMerchantCardData(merchant: MerchantView): MerchantCardData {
  return {
    id: merchant.id,
    name: merchant.name,
    email: merchant.email,
    phone: merchant.phone,
    contactName: merchant.contactName,
    site: merchant.site,
    status: merchant.status,
    createdAt: merchant.createdAt.toISOString(),
  };
}

/**
 * Владелец заявки строками. `bigint` границу сервера не переживает, а
 * решать по владельцу, что показать справа, нужно уже в браузере.
 */
export type OwnerData =
  | { readonly kind: 'client'; readonly clientId: string }
  | { readonly kind: 'merchant'; readonly merchantId: string };

export function toOwnerData(owner: Owner): OwnerData {
  return owner.kind === 'client'
    ? { kind: 'client', clientId: owner.clientId.toString() }
    : { kind: 'merchant', merchantId: owner.merchantId };
}
