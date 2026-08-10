import { z } from 'zod';
import { exchangeKindSchema } from '@nemo/types';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';
import { botToken, deliverNotifications } from '@nemo/telegram';
import { nudgeStaffAlerts } from '@/lib/staff-alert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const submitSchema = z.object({
  kind: exchangeKindSchema,
  fromCode: z.string().min(2).max(12),
  toCode: z.string().min(2).max(12),
  // Сумма приходит строкой и строкой же уходит в операцию: через
  // `number` дробная часть криптовалюты потерялась бы ещё до проверки.
  fromAmount: z.string(),
  requisitesId: z.string().uuid().optional(),
  /**
   * Отметка курса, показанного клиенту. Не курс: назвать цену клиент не
   * может, а сослаться на ту, что назвал сервис, — да. Незнакомую
   * отметку ядро молча заменит текущим курсом.
   */
  quotedAt: z.coerce.date().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Заявка на обмен заполнена не полностью');
    }

    const { request: created, notifications } = await getCore().submitExchangeRequest(
      { type: 'client', telegramUserId: initData.telegramUserId },
      parsed.data,
    );
    // Сотрудникам о заявке сообщает панель: клиентский деплой только
    // говорит ей, что появился повод. Ответа не ждём — клиент ждёт
    // своего.
    //
    // Раньше доставки клиенту, а не после: та ходит в Telegram, и её
    // отказ не должен уносить с собой уведомление менеджеру. Заявка к
    // этому моменту уже записана.
    nudgeStaffAlerts();
    await deliverNotifications(notifications, { botToken: botToken() });

    return json({ request: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const requests = await getCore().listExchangeRequests({
      type: 'client',
      telegramUserId: initData.telegramUserId,
    });
    return json({ requests });
  } catch (error) {
    return errorResponse(error);
  }
}
