import { botToken, deliverNotifications } from '@nemo/telegram';
import { nudgeStaffAlerts } from '@/lib/staff-alert';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Заявка на виртуальную карту.
 *
 * Тело у запроса пустое: заявка — это сам факт обращения. Сервис карту
 * не выпускает и её данных не хранит, спрашивать нечего.
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const applications = await getCore().listCardApplications({
      type: 'client',
      telegramUserId: initData.telegramUserId,
    });
    return json({ applications });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const { application, notifications } = await getCore().submitCardApplication({
      type: 'client',
      telegramUserId: initData.telegramUserId,
    });
    // Раньше доставки клиенту: её отказ не должен уносить с собой
    // уведомление менеджеру. Заявка к этому моменту уже записана.
    nudgeStaffAlerts();
    await deliverNotifications(notifications, { botToken: botToken() });

    return json({ application }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
