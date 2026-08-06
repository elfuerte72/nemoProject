import { botToken, deliverNotifications } from '@nemo/telegram';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Просьба оплатить что-то за границей: бронь отеля, покупку в
 * зарубежном магазине.
 *
 * Правила — состав тем, потолок длины, подпись обращения — живут в
 * ядре: маршрут разбирает запрос и зовёт операцию.
 */

export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const body: unknown = await request.json().catch(() => ({}));
    const input = body as { topic?: unknown; details?: unknown };

    const { notifications } = await getCore().submitInquiry({
      telegramUserId: initData.telegramUserId,
      topic: typeof input.topic === 'string' ? input.topic : '',
      details: typeof input.details === 'string' ? input.details : '',
      ...(initData.username ? { username: initData.username } : {}),
    });

    /*
     * Просьба принята — и остаётся принятой, даже если уведомление до
     * менеджера не доехало.
     *
     * Отказ доставки не должен превращаться в отказ операции: клиент
     * прочитал бы «не удалось отправить» о просьбе, которая уже лежит в
     * переписке, и отправил бы её второй раз. Менеджер увидит её и без
     * уведомления — она в той же ленте, что и остальные обращения.
     */
    try {
      await deliverNotifications(notifications, { botToken: botToken() });
    } catch (failure) {
      console.error('Уведомление о просьбе не доставлено:', failure);
    }

    return json({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
