import type { Notification } from '@nemo/core';
import { deliverNotifications, hasMerchantMail, readMailEnvironment } from '@nemo/email';
import { getCore } from '@/lib/core';

/**
 * Письма мерчанту из панели.
 *
 * Уведомления возвращает та же операция, что и раньше, а доставщиков у
 * них теперь два: клиенту пишет бот, мерчанту — почта. Оба зовутся
 * рядом и оба берут своё; решать по виду уведомления, кого звать,
 * значило бы повторять этот выбор в каждом маршруте.
 *
 * Ник поддержки читается из настроек и только тогда, когда письмо есть:
 * заявок клиентов на порядок больше, и лишний запрос к базе на каждом
 * переходе очереди — плата ни за что.
 */
export async function deliverMail(notifications: readonly Notification[]): Promise<void> {
  if (!hasMerchantMail(notifications)) return;

  const { delivery, cabinetUrl } = readMailEnvironment();
  const supportUsername = await getCore().merchantSupportUsername();

  await deliverNotifications(notifications, { delivery, cabinetUrl, supportUsername });
}
