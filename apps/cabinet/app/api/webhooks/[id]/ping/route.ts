import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { toDeliveryRow } from '@/lib/webhook-rows';
import { deliverWebhookNow } from '@/lib/webhooks/start';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Пробная доставка: `ping` в очередь и сразу отправка этой одной
 * строки, чтобы ответ приёмника показать здесь же, а не через пять
 * секунд. Чужую очередь запрос не разбирает; если строку успел забрать
 * воркер, ответ придёт тихим обновлением.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const core = getCore();

    const queued = await core.enqueueWebhookPing(actor, id);
    await deliverWebhookNow(queued.id);
    const delivery = await core.getWebhookDelivery(actor, queued.id);

    return json({ delivery: toDeliveryRow(delivery) });
  } catch (error) {
    return errorResponse(error);
  }
}
