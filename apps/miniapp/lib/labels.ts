import type {
  BonusTransactionKind,
  CardApplicationStatus,
  RequisiteKind,
  WithdrawalMethod,
  WithdrawalRequestStatus,
} from '@nemo/types';

/**
 * Состояния и виды на языке клиента.
 *
 * Терминов из `CONTEXT.md` — «заявка на вывод», «заявка на карту»,
 * «бонусный баланс» — эти подписи держатся, но сами состояний в словаре
 * нет: он описывает сущности, а не их шаги. Одинаково называть шаги
 * всё равно нужно, иначе разговор в поддержке начинается с выяснения,
 * чьё «одобрена» что значит.
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
  cancelled: 'Отозвана',
};

/**
 * Способ получения денег — так, как клиент его выбирает. Не «тип
 * реквизита»: слово «реквизит» в форме означало бы, что человек уже
 * знает, чем они бывают.
 */
export const REQUISITE_KIND_LABELS: Record<RequisiteKind, string> = {
  phone: 'По номеру телефона',
  card: 'На карту',
  wallet: 'На криптокошелёк',
};

export const BONUS_KIND_LABELS: Record<BonusTransactionKind, string> = {
  accrual: 'Начисление',
  withdrawal: 'Выплата',
  adjustment: 'Правка администратором',
};
