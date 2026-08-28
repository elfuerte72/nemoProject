import type { InquiryTopic, ServiceAccountView } from '@nemo/core';
import type {
  CardApplicationStatus,
  PayoutMethod,
  RequisiteKind,
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

/**
 * Способ получения денег — словами, а не набором заполненных полей.
 * Менеджер не должен выбирать за клиента между телефоном и картой.
 */
export const REQUISITE_KIND_LABELS: Record<RequisiteKind, string> = {
  phone: 'Перевод по номеру телефона',
  card: 'Перевод на карту',
  wallet: 'Перевод на криптокошелёк',
  account: 'Перевод на тайский банковский счёт',
  promptpay: 'Thai QR (PromptPay)',
  alipay: 'Alipay по телефону или e-mail',
  alipay_qr: 'Alipay по QR приёма',
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  manager: 'Менеджер',
  admin: 'Администратор',
};

/**
 * Куда уходят деньги клиенту — тем же словом, каким об этом говорит
 * сетка комиссии. У перевода способ берётся из записи: телефон, карта и
 * тайский счёт — банк, криптокошелёк и Alipay — кошелёк, у PromptPay
 * решает идентификатор внутри QR. Наличные стоят третьим способом, и
 * ставка у них своя: наличный обмен стоит сервису другого — касса,
 * встреча, риск, — а до заведения этой ставки курс наличных сервис не
 * называет вовсе.
 */
export const FEE_PAYOUT_LABELS: Record<PayoutMethod, string> = {
  bank: 'на банковский счёт',
  wallet: 'в электронный кошелёк',
  cash: 'наличными на руки',
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

/**
 * Чем счёт сервиса узнаётся — одной строкой и в одном месте.
 *
 * Своя копия подписи из ядра, как и у реквизитов клиента в Mini App:
 * ядро тянет за собой драйвер базы, и импорт функции оттуда увёз бы его
 * в браузер. Копия при этом одна на всю панель — счёт выбирают на двух
 * экранах, и разойдись они, один и тот же счёт назывался бы в списке и
 * в заявке по-разному.
 *
 * Заметки здесь нет: в списке счетов она стоит своей строкой, а в
 * выборе — приклеивается к подписи, потому что строка там одна.
 */
export function describeServiceAccount(account: ServiceAccountView): string {
  switch (account.kind) {
    case 'phone':
      return [account.bankName, account.phone, account.holderName]
        .filter(Boolean)
        .join(' · ');
    case 'card':
      return [
        account.bankName,
        `карта •••• ${account.cardLast4 ?? ''}`.trim(),
        account.holderName,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'wallet':
      return [account.network, account.addressHint].filter(Boolean).join(' · ');
  }
}

/**
 * О чём просьба клиента. Пилюлей в списке обращений: просьба про деньги
 * должна отличаться от «а какой курс» до того, как менеджер прочитал
 * строку.
 */
export const INQUIRY_TOPIC_LABELS: Record<InquiryTopic, string> = {
  hotel: 'Отель',
  purchase: 'Покупка',
};

/** Класс пилюли по её цвету: разметка не решает, каким он бывает. */
export function pillClass(tone: PillTone): string {
  return tone === 'plain' ? 'pill' : `pill pill--${tone}`;
}
