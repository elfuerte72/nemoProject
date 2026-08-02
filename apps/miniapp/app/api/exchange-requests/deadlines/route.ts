import { timingSafeEqual } from 'node:crypto';
import { botToken, deliverNotifications } from '@nemo/telegram';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Срок оплаты: предупредить тех, у кого он кончается, и отменить тех,
 * у кого кончился.
 *
 * Вызывается периодически извне — планировщиком развёртывания. Своего
 * планировщика в проект не заводится: приложения разворачиваются на
 * serverless, где фоновому процессу негде жить, а расписание всё равно
 * настраивается там же, где деплой.
 *
 * Защищён общим секретом. Не подписью Telegram: обращается сюда не
 * клиент и не бот, а планировщик, и подписывать ему нечем.
 *
 * `POST`, а не `GET`: вызов меняет состояние — отменяет заявки и шлёт
 * сообщения, — и кэшировать его нельзя ни браузеру, ни посреднику.
 *
 * Порядок важен: сначала предупреждение, потом отмена. Иначе заявка,
 * которую этот же прогон отменяет, успела бы получить сообщение
 * «осталось несколько минут» — и следом отмену.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = process.env.SCHEDULER_SECRET;
  if (!expected) {
    return new Response('Проверка сроков не настроена', { status: 500 });
  }
  if (!matches(request.headers.get('authorization'), `Bearer ${expected}`)) {
    return new Response('Неверный секрет', { status: 401 });
  }

  try {
    const core = getCore();
    // Момент берётся здесь и передаётся обеим операциям: обе смотрят на
    // один и тот же миг, и заявка не может оказаться одновременно
    // «предупреждена по одному времени» и «отменена по другому».
    const at = new Date();

    const warnings = await core.warnAboutExpiringExchangeRequests(at);
    const expired = await core.expireUnpaidExchangeRequests(at);

    await deliverNotifications([...warnings, ...expired], { botToken: botToken() });

    return json({ warned: warnings.length, expired: expired.length });
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
