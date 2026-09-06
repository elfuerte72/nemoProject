import { botToken, deliverNotifications } from '@nemo/telegram';
import { schedulerCallDenied } from '@nemo/http';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import { deliverMail } from '@/lib/mail';

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
  const denied = schedulerCallDenied(request);
  if (denied) return denied;

  try {
    const core = getCore();
    // Момент берётся здесь и передаётся обеим операциям: обе смотрят на
    // один и тот же миг, и заявка не может оказаться одновременно
    // «предупреждена по одному времени» и «отменена по другому».
    const at = new Date();

    const warnings = await core.warnAboutExpiringExchangeRequests(at);
    const expired = await core.expireUnpaidExchangeRequests(at);

    // Заявка бывает и мерчантской (docs/adr/0017): срок у неё тот же, а
    // адрес почтовый — доставщики зовутся оба.
    await deliverNotifications([...warnings, ...expired], { botToken: botToken() });
    await deliverMail([...warnings, ...expired]);

    return json({ warned: warnings.length, expired: expired.length });
  } catch (error) {
    return errorResponse(error);
  }
}
