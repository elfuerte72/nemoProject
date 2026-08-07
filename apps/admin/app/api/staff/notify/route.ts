import { schedulerCallDenied } from '@nemo/http';
import { deliverNotifications } from '@nemo/telegram';
import { errorResponse, json } from '@/lib/api';
import { loginBotToken } from '@/lib/auth/login-bot';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Разослать сотрудникам то, о чём им ещё не говорили: обращения
 * клиентов и новые заявки.
 *
 * Отдельным маршрутом в панели, а не ответом на само событие: шлёт их
 * бот входа в админку, и его токен лежит только здесь (docs/adr/0005).
 * Клиентское приложение, которое принимает и сообщение, и заявку, до
 * него не дотягивается — и не должно: утечка клиентского контура
 * отдавала бы первый фактор входа.
 *
 * Зовут его двое, и оба одним секретом. Планировщик — раз в несколько
 * минут, чтобы ничего не потерялось. Клиентский деплой — сразу после
 * события, чтобы менеджер узнал о нём не через эти минуты, а через
 * секунду. Второй вызов страховкой не является, а первый ею и остаётся:
 * толчок по сети может не дойти, и тогда повод доедет следующим
 * прогоном.
 *
 * Повторный вызов ничего не дублирует: отметка о рассылке ставится
 * условным изменением внутри операции.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = schedulerCallDenied(request);
  if (denied) return denied;

  try {
    const notifications = await getCore().takeStaffAlerts(new Date());
    await deliverNotifications(notifications, {
      botToken: loginBotToken(),
      ...(process.env.ADMIN_URL
        ? { panelUrl: process.env.ADMIN_URL.replace(/\/+$/, '') }
        : {}),
    });

    return json({ sent: notifications.length });
  } catch (error) {
    return errorResponse(error);
  }
}
