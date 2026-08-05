import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { botToken, deliverNotifications } from '@nemo/telegram';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Заявки на вывод бонусных баллов.
 *
 * Реквизитов в теле запроса больше нет: заявка ссылается на запись из
 * списка клиента, а сама запись заводится через `/api/requisites`. Туда
 * же переехало и единственное место, где реквизит виден открытым.
 */

const submitSchema = z.object({
  // Сумма строкой: через `number` дробная часть потерялась бы ещё до
  // проверки.
  amount: z.string(),
  // Чья это запись, не архивна ли она и жива ли её сеть — дело операции,
  // а не разбора запроса.
  requisitesId: z.string().uuid(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const requests = await getCore().listWithdrawalRequests({
      type: 'client',
      telegramUserId: initData.telegramUserId,
    });
    return json({ requests });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Заявка на вывод заполнена не полностью');
    }

    const { request: created, notifications } = await getCore().submitWithdrawalRequest(
      { type: 'client', telegramUserId: initData.telegramUserId },
      parsed.data,
    );
    await deliverNotifications(notifications, { botToken: botToken() });

    return json({ request: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
