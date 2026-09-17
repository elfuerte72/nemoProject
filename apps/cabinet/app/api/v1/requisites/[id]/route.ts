import { json } from '@nemo/http';
import { getCore } from '@/lib/core';
import { requireRequisitesId } from '@/lib/v1/ids';
import { v1 } from '@/lib/v1/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Удаление записи — на деле архив: на неё ссылаются поданные заявки,
 * и вычеркнуть её из них значило бы стереть, куда ушли деньги.
 */
export const DELETE = v1<{ id: string }>(async (_request, ctx, _body, { id }) => {
  await getCore().archiveRequisites(ctx.actor, requireRequisitesId(id));
  return json({ ok: true });
});
