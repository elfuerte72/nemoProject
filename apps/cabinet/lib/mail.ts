import type { Notification } from '@nemo/core';
import {
  deliverNotifications,
  hasMerchantMail,
  mailWorks,
  readMailEnvironment,
} from '@nemo/email';
import { InvalidInputError } from '@nemo/core';
import { getCore } from '@/lib/core';

/**
 * Письма из кабинета: подтверждение почты и сброс пароля.
 *
 * В отличие от панели, здесь письмо — часть самого действия, а не
 * следствие: регистрация без письма заводит аккаунт, который некому
 * подтвердить, а «забыли пароль» без письма молчит в ответ. Поэтому
 * почта спрашивается до операции и отказ говорится словами: выключенная
 * почта — рабочее состояние деплоя, а не поломка, но узнать о ней
 * мерчант должен раньше, чем заведёт кабинет.
 */
export function requireMail(): void {
  const { delivery } = readMailEnvironment();
  if (!mailWorks(delivery)) {
    throw new InvalidInputError(
      'Почта не настроена: заведение кабинета и сброс пароля пока недоступны. ' +
        'Напишите в поддержку.',
    );
  }
}

export async function deliverMail(notifications: readonly Notification[]): Promise<void> {
  if (!hasMerchantMail(notifications)) return;

  const { delivery, cabinetUrl } = readMailEnvironment();
  const supportUsername = await getCore().merchantSupportUsername();

  await deliverNotifications(notifications, { delivery, cabinetUrl, supportUsername });
}
