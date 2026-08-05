import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Вся история клиента одной лентой: заявки на обмен, движения по
 * баллам, заявки на вывод и на карту.
 *
 * Одним запросом, а не четырьмя из браузера: раздел открывают с
 * телефона, и четыре круга по мобильной сети вместо одного видны прямо
 * в том, как долго он собирается.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const history = await getCore().getClientHistory({
      type: 'client',
      telegramUserId: initData.telegramUserId,
    });
    return json({ history });
  } catch (error) {
    return errorResponse(error);
  }
}
