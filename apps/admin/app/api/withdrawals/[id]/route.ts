import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { botToken, deliverNotifications } from '@nemo/telegram';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Обработка заявки на вывод менеджером.
 *
 * Один маршрут на все переходы — как и у заявки на обмен: какие
 * переходы существуют, решает операция, и разносить это ещё и по
 * адресам значило бы описывать таблицу состояний дважды.
 */
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('pay') }),
  z.object({ action: z.literal('reject'), reason: z.string() }),
  z.object({ action: z.literal('reveal') }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;

    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Действие не распознано');
    }
    const input = parsed.data;
    const core = getCore();

    // Реквизиты получения — не переход, а чтение: своей ветвью, чтобы
    // не притворяться, будто заявка от этого меняется.
    if (input.action === 'reveal') {
      return json({ destination: await core.revealWithdrawalDestination(actor, id) });
    }

    const result = await (async () => {
      switch (input.action) {
        case 'approve':
          return core.approveWithdrawalRequest(actor, id);
        case 'pay':
          return core.markWithdrawalPaid(actor, id);
        case 'reject':
          return core.rejectWithdrawalRequest(actor, id, { reason: input.reason });
      }
    })();

    await deliverNotifications(result.notifications, { botToken: botToken() });
    return json({ request: result.request });
  } catch (error) {
    return errorResponse(error);
  }
}
