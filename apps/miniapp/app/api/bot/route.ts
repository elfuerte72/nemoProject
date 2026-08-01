import { webhookCallback } from 'grammy';
import { getBot } from '@/lib/telegram/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Вебхук Telegram.
 *
 * Секретный токен обязателен: адрес вебхука рано или поздно утекает,
 * и без него кто угодно сможет присылать боту поддельные обновления.
 * Устанавливается при вызове setWebhook параметром `secret_token`.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    return new Response('Вебхук не настроен', { status: 500 });
  }
  if (request.headers.get('x-telegram-bot-api-secret-token') !== expected) {
    return new Response('Неверный секрет вебхука', { status: 401 });
  }

  return webhookCallback(getBot(), 'std/http')(request);
}
