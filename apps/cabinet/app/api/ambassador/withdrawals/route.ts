import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { botToken, deliverNotifications } from '@nemo/telegram';
import { errorResponse, json } from '@/lib/api';
import { requireAmbassador } from '@/lib/ambassador';
import { getCore } from '@/lib/core';
import { nudgeStaffAlerts } from '@/lib/staff-alert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Заявка на вывод от амбассадора.
 *
 * Операции те же, что у клиента в Mini App: очередь выплат у менеджера
 * одна на всех, и вторая означала бы, что часть заявок никто не видит.
 * Клиент здесь и там один — тот же `Actor` по тому же
 * `telegram_user_id`.
 */

const submitSchema = z.object({
  // Сумма строкой: через `number` дробная часть потерялась бы ещё до
  // проверки.
  amount: z.string(),
  requisitesId: z.string().uuid(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const { actor } = await requireAmbassador();
    const parsed = submitSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new InvalidInputError('Заявка на вывод заполнена не полностью');
    }

    const { request: created, notifications } = await getCore().submitWithdrawalRequest(
      actor,
      parsed.data,
    );
    // Раньше доставки: её отказ не должен уносить с собой уведомление
    // менеджеру. Заявка к этому моменту уже записана.
    nudgeStaffAlerts();
    await deliverNotifications(notifications, { botToken: botToken() });

    return json({ request: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
