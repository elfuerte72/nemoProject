import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Удаление точки: ожидающие доставки гаснут, история остаётся. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    await getCore().removeWebhookEndpoint(actor, id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
