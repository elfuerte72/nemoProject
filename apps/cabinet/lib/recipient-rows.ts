import type { RequisitesView } from '@nemo/core';
import {
  requisiteCurrencyCodes,
  requisiteKindsFor,
  type PromptPayIdType,
  type RequisiteKind,
} from '@nemo/types';

/**
 * Запись получателя для экрана — датами-строками: список живёт в
 * клиентском компоненте, и `Date` через его границу не переезжает.
 *
 * Номера здесь нет и не бывает: хвосты и края, как их видит владелец
 * записи. Полное значение расшифровывает только панель менеджера
 * (docs/adr/0002).
 */
export interface RecipientRow {
  readonly id: string;
  readonly kind: RequisiteKind;
  readonly bankName: string | null;
  readonly phone: string | null;
  readonly cardLast4: string | null;
  readonly network: string | null;
  readonly addressHint: string | null;
  readonly holderName: string | null;
  readonly accountLast4: string | null;
  readonly qrHint: string | null;
  readonly promptpayIdType: PromptPayIdType | null;
  readonly alipayAccount: string | null;
  readonly isAvailable: boolean;
  readonly createdAt: string;
}

export function toRecipientRow(view: RequisitesView): RecipientRow {
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
    promptpayIdType: view.promptpayIdType,
    alipayAccount: view.alipayAccount,
    isAvailable: view.isAvailable,
    createdAt: view.createdAt.toISOString(),
  };
}

/**
 * Валюта, которая приходит на запись этого рода. У записи своей валюты
 * нет — её называет род, и таблица «род — валюта» одна, в доменных
 * типах: по ней же ядро принимает запись к заявке.
 */
export function recipientCurrency(kind: RequisiteKind): string | null {
  return requisiteCurrencyCodes().find((code) => requisiteKindsFor(code).includes(kind)) ?? null;
}
