import type { Amount, ExchangeRequestStatus, ReferralLine } from '@nemo/types';

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
        : 'В вашей второй линии новый партнёр: ваш реферал привёл знакомого.';
    case 'exchange-request-status':
      return renderExchangeRequestStatus(notification);
  }
}

function renderExchangeRequestStatus(
  notification: Extract<Notification, { kind: 'exchange-request-status' }>,
): string {
  switch (notification.status) {
    case 'new':
      return 'Заявка принята. Её возьмёт менеджер — вы получите сообщение.';
    case 'in_progress':
      return 'Менеджер взял вашу заявку в работу и скоро назовёт финальный курс.';
    case 'rate_confirmed':
      return [
        `Финальный курс по вашей заявке: ${notification.finalRate ?? '—'}.`,
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
        ? `Заявка отменена. Причина: ${notification.cancelReason}`
        : 'Заявка отменена.';
  }
}
