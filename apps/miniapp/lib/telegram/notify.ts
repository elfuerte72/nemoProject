import { renderNotification, type Notification } from '@nemo/core';
import { getBot } from '@/lib/telegram/bot';

/**
 * Доставка уведомлений, которые вернула операция.
 *
 * Сбой отправки не отменяет уже совершённое действие: заявка подана и
 * деньги учтены независимо от того, дошло ли сообщение. Клиент,
 * заблокировавший бота, — обычное дело, и падать на нём маршрут не
 * должен.
 */
export async function deliver(notifications: readonly Notification[]): Promise<void> {
  if (notifications.length === 0) return;

  const bot = getBot();
  await Promise.all(
    notifications.map(async (notification) => {
      try {
        await bot.api.sendMessage(Number(notification.to), renderNotification(notification));
      } catch (error) {
        console.error('Не удалось отправить уведомление', notification.kind, error);
      }
    }),
  );
}
