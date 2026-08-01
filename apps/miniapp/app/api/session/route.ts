import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';
import { botToken, deliverNotifications } from '@nemo/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Открытие приложения: клиент становится клиентом.
 *
 * Отдельного шага регистрации нет — первый запуск создаёт клиента,
 * повторный возвращает уже существующего. Реферальная привязка
 * выполняется здесь же, потому что только здесь `telegram_user_id`
 * подтверждён подписью бота: код из ссылки без такого подтверждения
 * позволил бы записать реферала кому угодно.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);

    const { client, created, notifications } = await getCore().registerClient({
      telegramUserId: initData.telegramUserId,
      username: initData.username,
      referralCode: initData.startParam,
    });

    await deliverNotifications(notifications, { botToken: botToken() });

    return json({ client, created });
  } catch (error) {
    return errorResponse(error);
  }
}
