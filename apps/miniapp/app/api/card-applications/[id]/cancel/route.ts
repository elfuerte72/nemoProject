import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';
import { botToken, deliverNotifications } from '@nemo/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Отзыв заявки на карту клиентом.
 *
 * Причину клиент не объясняет: передумать — его право, пока провайдер за
 * заявку не взялся. Где проходит эта граница, решает операция, а не
 * маршрут.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const { id } = await context.params;

    const result = await getCore().cancelOwnCardApplication(
      { type: 'client', telegramUserId: initData.telegramUserId },
      id,
    );
    await deliverNotifications(result.notifications, { botToken: botToken() });

    return json({ application: result.application });
  } catch (error) {
    return errorResponse(error);
  }
}
