import { schedulerCallDenied } from '@nemo/http';
import { botToken, deliverNotifications } from '@nemo/telegram';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import { nudgeStaffAlerts } from '@/lib/staff-alert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ответить тем, за чьё сообщение консьерж взялся и не ответил.
 *
 * Страховка, а не основной путь: обычно ответ уходит в фоне сразу за
 * сообщением клиента. Но фон живёт в памяти процесса, и переживает он не
 * всё — выкатку, падение обработчика, зависший дольше своего срока
 * запрос к провайдеру. Без этого прогона такой клиент остался бы без
 * ответа вовсе, и заметил бы это он, а не сервис.
 *
 * Вызывается тем же планировщиком и тем же секретом, что и проверка
 * сроков оплаты.
 *
 * Ответить дважды прогон не может: сообщение занимается условным
 * изменением внутри операции, и наложившийся на фон вызов не найдёт
 * ждущего.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = schedulerCallDenied(request);
  if (denied) return denied;

  try {
    const core = getCore();
    const waiting = await core.listConversationsAwaitingConcierge();

    /*
     * По очереди, а не разом. Разговоров здесь единицы — это те, у кого
     * фон не дошёл, — а каждый из них уходит к провайдеру: десяток
     * одновременных запросов к нему упрётся в его же ограничения и
     * вернётся отказами, то есть эскалациями на пустом месте.
     */
    let answered = 0;
    let escalated = 0;
    for (const telegramUserId of waiting) {
      const result = await core.answerAsConcierge({ telegramUserId });
      if (result.notifications.length === 0) continue;

      answered += 1;
      if (result.handedToHuman) escalated += 1;
      await deliverNotifications(result.notifications, {
        botToken: botToken(),
        miniappUrl: process.env.MINIAPP_URL,
      });
    }

    // Панель будим только если кого-то передали человеку: обычный ответ
    // повода для сотрудников не создаёт.
    if (escalated > 0) {
      nudgeStaffAlerts();
    }

    return json({ waiting: waiting.length, answered });
  } catch (error) {
    return errorResponse(error);
  }
}
