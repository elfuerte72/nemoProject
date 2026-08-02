import { timingSafeEqual } from 'node:crypto';
import { deliverNotifications } from '@nemo/telegram';
import { errorResponse, json } from '@/lib/api';
import { loginBotToken } from '@/lib/auth/login-bot';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Разослать сотрудникам новые обращения.
 *
 * Отдельным маршрутом в панели, а не ответом на само сообщение: шлёт их
 * бот входа в админку, и его токен лежит только здесь (docs/adr/0005).
 * Клиентское приложение, которое принимает сообщение, до него не
 * дотягивается — и не должно: утечка клиентского контура отдавала бы
 * первый фактор входа.
 *
 * Вызывается тем же планировщиком, что и проверка сроков оплаты, и тем
 * же секретом защищён. Отметка о рассылке ставится условным изменением:
 * два наложившихся вызова не разошлют одно обращение дважды.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = process.env.SCHEDULER_SECRET;
  if (!expected) {
    return new Response('Рассылка обращений не настроена', { status: 500 });
  }
  if (!matches(request.headers.get('authorization'), `Bearer ${expected}`)) {
    return new Response('Неверный секрет', { status: 401 });
  }

  try {
    const notifications = await getCore().takeStaffNotifications(new Date());
    await deliverNotifications(notifications, {
      botToken: loginBotToken(),
      ...(process.env.ADMIN_URL
        ? { panelUrl: `${process.env.ADMIN_URL.replace(/\/+$/, '')}/conversations` }
        : {}),
    });

    return json({ sent: notifications.length });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Сравнение секретов постоянным временем: обычное сравнение строк
 * отвечает тем быстрее, чем раньше расходятся байты, и по времени
 * ответа секрет подбирается посимвольно.
 */
function matches(received: string | null, expected: string): boolean {
  if (received === null) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
