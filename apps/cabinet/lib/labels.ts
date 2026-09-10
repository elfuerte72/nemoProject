import type {
  ExchangeKind,
  ExchangeRequestStatus,
  MerchantStatus,
  WithdrawalRequestStatus,
} from '@nemo/types';

/**
 * Состояния заявки словами из `CONTEXT.md`: те же, что у клиента и у
 * менеджера. Разговор мерчанта с менеджером начинается с номера заявки,
 * и второе название того же шага стоило бы обоим минуты выяснения.
 */
export const STATUS_LABELS: Record<ExchangeRequestStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  rate_confirmed: 'Курс подтверждён',
  payment_received: 'Оплата получена',
  completed: 'Исполнена',
  cancelled: 'Отменена',
};

/**
 * Состояния заявки на вывод — теми же словами, какими их называет
 * клиенту Mini App: у амбассадора и клиента очередь выплат одна, и два
 * названия одного шага стоили бы менеджеру минуты выяснения.
 */
export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalRequestStatus, string> = {
  new: 'Новая — ждёт менеджера',
  approved: 'Одобрена — готовим выплату',
  paid: 'Выплачена',
  rejected: 'Отклонена',
};

export type PillTone = 'plain' | 'wait' | 'done' | 'off';

/**
 * Цвет состояния — по тому же правилу, что в панели: золотом отмечено
 * то, что ждёт того, кто смотрит. Только ждут здесь разного: у
 * менеджера золото на новой заявке, у мерчанта — на подтверждённом
 * курсе, потому что дальше платит он.
 */
export const STATUS_TONES: Record<ExchangeRequestStatus, PillTone> = {
  new: 'plain',
  in_progress: 'plain',
  rate_confirmed: 'wait',
  payment_received: 'plain',
  completed: 'done',
  cancelled: 'off',
};

export const KIND_LABELS: Record<ExchangeKind, string> = {
  electronic: 'электронный перевод',
  cash: 'наличные',
};

/** Состояние самого мерчанта — так, как оно называется в панели. */
export const MERCHANT_STATUS_LABELS: Record<MerchantStatus, string> = {
  pending: 'На рассмотрении',
  active: 'Активен',
  rejected: 'Отклонён',
  disabled: 'Отключён',
};
