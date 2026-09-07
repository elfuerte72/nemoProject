import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { deliverMail } from '@/lib/mail';
import { toKeyRow } from '@/lib/key-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Отзыв ключа: запросы с ним получают отказ в ту же секунду. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;

    const revoked = await getCore().revokeApiKey(actor, id);
    await deliverMail(revoked.notifications);

    return json({ key: toKeyRow(revoked.key) });
  } catch (error) {
    return errorResponse(error);
  }
}
