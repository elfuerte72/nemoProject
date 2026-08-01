import type {
  Amount,
  CardApplicationStatus,
  ExchangeRequestStatus,
  ReferralLine,
  WithdrawalRequestStatus,
} from '@nemo/types';

/**
 * Что нужно сообщить клиенту — следствие операции, а не отдельное
 * действие.
 *
 * Операция возвращает описание сообщения, адаптер его отправляет. Так
 * уведомление нельзя забыть, добавив новый переход: тест видит его в
 * результате операции, не поднимая Telegram. Обратный порядок — «после
 * смены статуса не забыть позвать бота» — держится только на памяти
 * того, кто пишет следующий переход.
 */
export type Notification =
  | {
      readonly kind: 'referral-joined';
      readonly to: bigint;
      readonly line: ReferralLine;
    }
  | {
      readonly kind: 'exchange-request-status';
      readonly to: bigint;
      readonly requestId: string;
      readonly status: ExchangeRequestStatus;
      /** Курс, названный менеджером: только в переходе «курс подтверждён». */
      readonly finalRate?: Amount;
      /** Куда клиенту платить: только в переходе «курс подтверждён». */
      readonly paymentInstructions?: string;
      /** Причина отмены: обязательна, когда отменяет менеджер. */
      readonly cancelReason?: string;
    }
  | {
      readonly kind: 'bonus-accrued';
      readonly to: bigint;
      readonly line: ReferralLine;
      readonly amount: Amount;
    }
  | {
      readonly kind: 'withdrawal-request-status';
      readonly to: bigint;
      readonly status: WithdrawalRequestStatus;
      readonly amount: Amount;
      /** Причина отказа: обязательна при отклонении. */
      readonly rejectReason?: string;
    }
  | {
      readonly kind: 'card-application-status';
      readonly to: bigint;
      readonly status: CardApplicationStatus;
    };

/**
 * Текст сообщения для клиента.
 *
 * Живёт в модуле операций, а не в боте, потому что уведомления
 * отправляют оба приложения: клиентское — о регистрации реферала,
 * админка — о переходах заявки. Два набора формулировок разошлись бы.
 */
export function renderNotification(notification: Notification): string {
  switch (notification.kind) {
    case 'referral-joined':
      return notification.line === 1
        ? 'По вашей ссылке зарегистрировался новый клиент. ' +
            'Баллы начислятся, когда он совершит обмен.'
        : 'У вас новый реферал во второй линии: ваш реферал привёл знакомого.';
    case 'exchange-request-status':
      return renderExchangeRequestStatus(notification);
    case 'bonus-accrued':
      return (
        `Вам начислено ${notification.amount} баллов за исполненную заявку ` +
        `реферала ${notification.line === 1 ? 'первой' : 'второй'} линии.`
      );
    case 'withdrawal-request-status':
      return renderWithdrawalRequestStatus(notification);
    case 'card-application-status':
      return renderCardApplicationStatus(notification.status);
  }
}

function renderExchangeRequestStatus(
  notification: Extract<Notification, { kind: 'exchange-request-status' }>,
): string {
  switch (notification.status) {
    case 'new':
      return 'Заявка на обмен принята. Её возьмёт менеджер — вы получите сообщение.';
    case 'in_progress':
      return 'Менеджер взял вашу заявку на обмен в работу и скоро назовёт финальный курс.';
    case 'rate_confirmed':
      return [
        notification.finalRate
          ? `Финальный курс по вашей заявке на обмен: ${notification.finalRate}.`
          : undefined,
        notification.paymentInstructions
          ? `Реквизиты для оплаты: ${notification.paymentInstructions}`
          : undefined,
        'После оплаты менеджер подтвердит поступление.',
      ]
        .filter((line) => line !== undefined)
        .join('\n');
    case 'payment_received':
      return 'Ваша оплата получена. Готовим отправку средств.';
    case 'completed':
      return 'Обмен исполнен, средства отправлены. Спасибо, что выбрали нас.';
    case 'cancelled':
      return notification.cancelReason
        ? `Заявка на обмен отменена. Причина: ${notification.cancelReason}`
        : 'Заявка на обмен отменена.';
  }
}

function renderWithdrawalRequestStatus(
  notification: Extract<Notification, { kind: 'withdrawal-request-status' }>,
): string {
  switch (notification.status) {
    case 'new':
      return `Заявка на вывод ${notification.amount} баллов принята. Менеджер её рассмотрит.`;
    case 'approved':
      return `Заявка на вывод ${notification.amount} баллов одобрена. Готовим выплату.`;
    case 'paid':
      return `Выплата ${notification.amount} баллов отправлена. Баллы списаны с бонусного баланса.`;
    case 'rejected':
      // Причина обязательна при отклонении, но тип уведомления допускает
      // её отсутствие: язык не даёт выразить «обязательна только здесь».
      return notification.rejectReason
        ? `Заявка на вывод отклонена. Причина: ${notification.rejectReason}`
        : 'Заявка на вывод отклонена.';
  }
}

function renderCardApplicationStatus(status: CardApplicationStatus): string {
  switch (status) {
    case 'submitted':
      return 'Заявка на карту принята. Мы сообщим, когда она сдвинется.';
    case 'processing':
      return 'Заявка на карту в обработке у провайдера.';
    case 'active':
      return 'Карта выпущена и активна. Менеджер свяжется с вами по получению.';
    case 'rejected':
      return 'Заявка на карту отклонена. Менеджер расскажет подробности.';
  }
}
