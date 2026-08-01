import { renderNotification, type Notification } from '@nemo/core';

/**
 * Доставка уведомлений, которые вернула операция.
 *
 * Общая для обоих приложений: переходы заявки на обмен запускает
 * админка, а регистрацию реферала — Mini App, и клиент должен получать
 * их одинаково. Две копии этой функции успели разойтись в том, как
 * передают идентификатор получателя, — а это ровно то место, где
 * ошибка молча уводит сообщение не туда.
 *
 * Отправка идёт прямым запросом к Bot API, без библиотеки бота:
 * обновления здесь не принимаются, нужна одна команда из всего
 * интерфейса.
 */

export interface DeliveryOptions {
  readonly botToken: string;
}

export async function deliverNotifications(
  notifications: readonly Notification[],
  options: DeliveryOptions,
): Promise<void> {
  if (notifications.length === 0) return;

  await Promise.all(
    notifications.map((notification) => send(notification, options.botToken)),
  );
}

/**
 * Сбой отправки не отменяет уже совершённое действие: заявка исполнена
 * и деньги учтены независимо от того, дошло ли сообщение. Клиент,
 * заблокировавший бота, не должен ломать работу менеджера.
 */
async function send(notification: Notification, botToken: string): Promise<void> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // Строкой, а не числом: `telegram_user_id` — bigint, и на
        // приведении к `number` он однажды потеряет точность.
        chat_id: notification.to.toString(),
        text: renderNotification(notification),
      }),
    });
    if (!response.ok) {
      console.error('Telegram отклонил уведомление', notification.kind, response.status);
    }
  } catch (error) {
    console.error('Не удалось отправить уведомление', notification.kind, error);
  }
}

/** Токен бота из окружения. Общий у обоих приложений — бот один. */
export function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('Не задан TELEGRAM_BOT_TOKEN');
  }
  return token;
}
