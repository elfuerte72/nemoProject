import type {
  CardApplicationStatus,
  StaffRole,
  WithdrawalMethod,
  WithdrawalRequestStatus,
} from '@nemo/types';

/**
 * Подписи админки. Рядом с подписями клиента по смыслу, но отдельно по
 * месту: у менеджера и клиента разные роли, и одинаково называться
 * должны состояния, а не пояснения к ним.
 */

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalRequestStatus, string> = {
  new: 'Новая',
  approved: 'Одобрена',
  paid: 'Выплачена',
  rejected: 'Отклонена',
};

export const WITHDRAWAL_METHOD_LABELS: Record<WithdrawalMethod, string> = {
  bank: 'Банковский счёт',
  crypto: 'Криптовалюта',
};

export const CARD_STATUS_LABELS: Record<CardApplicationStatus, string> = {
  submitted: 'Подана',
  processing: 'В обработке',
  active: 'Активна',
  rejected: 'Отклонена',
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  manager: 'Менеджер',
  admin: 'Администратор',
};
