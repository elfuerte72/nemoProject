import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { deliverMail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Отмена своей заявки.
 *
 * Пока её не взяли в работу: дальше отменяет менеджер — деньги уже
 * могли уйти. Это правило ядра, а не разметки: кнопку на экране можно
 * не показывать, но отказывает операция.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;

    const result = await getCore().cancelOwnExchangeRequest(actor, id);
    await deliverMail(result.notifications);

    return json({ request: result.request });
  } catch (error) {
    return errorResponse(error);
  }
}
