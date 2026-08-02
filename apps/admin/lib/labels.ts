import type {
  CardApplicationStatus,
  StaffRole,
  WithdrawalMethod,
  WithdrawalRequestStatus,
} from '@nemo/types';
import type { PillTone } from './exchange-request-labels.js';

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
  cancelled: 'Отозвана',
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  manager: 'Менеджер',
  admin: 'Администратор',
};

/** Золотом — то, что ждёт менеджера. Правило то же, что у заявок на обмен. */
export const WITHDRAWAL_STATUS_TONES: Record<WithdrawalRequestStatus, PillTone> = {
  new: 'wait',
  approved: 'wait',
  paid: 'done',
  rejected: 'off',
};

export const CARD_STATUS_TONES: Record<CardApplicationStatus, PillTone> = {
  submitted: 'wait',
  processing: 'plain',
  active: 'done',
  rejected: 'off',
  cancelled: 'off',
};

/** Класс пилюли по её цвету: разметка не решает, каким он бывает. */
export function pillClass(tone: PillTone): string {
  return tone === 'plain' ? 'pill' : `pill pill--${tone}`;
}
