import type {
  BonusTransactionKind,
  CardApplicationStatus,
  WithdrawalMethod,
  WithdrawalRequestStatus,
} from '@nemo/types';

/**
 * Состояния и виды на языке клиента.
 *
 * Формулировки взяты из `CONTEXT.md`: клиент, менеджер и код должны
 * называть одно и то же одинаково, иначе разговор в поддержке
 * начинается с выяснения, чьё «одобрена» что значит.
 */

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalRequestStatus, string> = {
  new: 'Новая — ждёт менеджера',
  approved: 'Одобрена — готовим выплату',
  paid: 'Выплачена',
  rejected: 'Отклонена',
};

export const WITHDRAWAL_METHOD_LABELS: Record<WithdrawalMethod, string> = {
  bank: 'На банковский счёт',
  crypto: 'В криптовалюте',
};

export const CARD_STATUS_LABELS: Record<CardApplicationStatus, string> = {
  submitted: 'Подана',
  processing: 'В обработке',
  active: 'Активна',
  rejected: 'Отклонена',
};

export const BONUS_KIND_LABELS: Record<BonusTransactionKind, string> = {
  accrual: 'Начисление',
  withdrawal: 'Выплата',
  adjustment: 'Правка администратором',
};
