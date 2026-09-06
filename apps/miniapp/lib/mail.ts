import type { Notification } from '@nemo/core';
import { deliverNotifications, hasMerchantMail, readMailEnvironment } from '@nemo/email';
import { getCore } from '@/lib/core';

/**
 * Письма мерчанту из клиентского приложения.
 *
 * Своих заявок мерчант здесь не подаёт — у него кабинет, — но срок
 * оплаты стережёт планировщик, который стучится сюда: предупреждение за
 * полчаса и отмена по истечении срока порождаются здесь и адресованы
 * тому, чья заявка. Копия помощника из панели: доставщиков у
 * уведомлений двое, и каждое приложение зовёт обоих.
 */
export async function deliverMail(notifications: readonly Notification[]): Promise<void> {
  if (!hasMerchantMail(notifications)) return;

  const { delivery, cabinetUrl } = readMailEnvironment();
  const supportUsername = await getCore().merchantSupportUsername();

  await deliverNotifications(notifications, { delivery, cabinetUrl, supportUsername });
}
