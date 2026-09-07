import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Удаление записи — на деле архив: на неё ссылаются поданные заявки, и
 * вычеркнуть её из них значило бы стереть, куда ушли деньги.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    await getCore().archiveRequisites(actor, id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
