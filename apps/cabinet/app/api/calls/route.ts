import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { CALLS_PAGE, pickOutcome, toCallRow } from '@/lib/call-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Хвост журнала вызовов — по курсору «время и номер». Отбор тот же,
 * что на странице, и берётся из одного места.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    const outcome = pickOutcome(params.get('outcome') ?? undefined);
    const after = params.get('after');
    const afterId = params.get('afterId');
    const keyId = params.get('key');

    const rows = await getCore().listApiRequestLog(actor, {
      limit: CALLS_PAGE,
      ...(outcome === 'all' ? {} : { outcome }),
      ...(keyId ? { keyId } : {}),
      ...(after && afterId && !Number.isNaN(Date.parse(after))
        ? { after: { at: new Date(after), id: afterId } }
        : {}),
    });

    return json({ rows: rows.map(toCallRow) });
  } catch (error) {
    return errorResponse(error);
  }
}
