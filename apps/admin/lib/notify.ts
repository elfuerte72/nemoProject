import { renderNotification, type Notification } from '@nemo/core';

/**
 * Доставка уведомлений клиенту из админки.
 *
 * Через HTTP API Telegram напрямую, без библиотеки бота: админка
 * сообщений не принимает и обновлений не обрабатывает — ей нужна ровно
 * одна команда из всего интерфейса.
 *
 * Сбой отправки не отменяет уже совершённое действие: заявка исполнена
 * и деньги учтены независимо от того, дошло ли сообщение. Клиент,
 * заблокировавший бота, не должен ломать работу менеджера.
 */
export async function deliver(notifications: readonly Notification[]): Promise<void> {
  if (notifications.length === 0) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('Не задан TELEGRAM_BOT_TOKEN: уведомления не отправлены');
    return;
  }

  await Promise.all(
    notifications.map(async (notification) => {
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
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
    }),
  );
}
