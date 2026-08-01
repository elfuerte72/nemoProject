import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';
import { botToken, deliverNotifications } from '@nemo/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Отмена заявки клиентом.
 *
 * Причину клиент не объясняет: передумать — его право, пока заявкой
 * никто не занялся. Дальше отменить может только менеджер, и уже с
 * объяснением — это решает операция, а не маршрут.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const { id } = await context.params;

    const actor = { type: 'client', telegramUserId: initData.telegramUserId } as const;
    const core = getCore();

    const result = await core.cancelExchangeRequest(actor, id);
    await deliverNotifications(result.notifications, { botToken: botToken() });

    // Операция отдаёт заявку в представлении менеджера — с доходом
    // сервиса. Клиенту уходит его собственное представление, где такого
    // поля нет вовсе.
    return json({ request: await core.getExchangeRequest(actor, id) });
  } catch (error) {
    return errorResponse(error);
  }
}
