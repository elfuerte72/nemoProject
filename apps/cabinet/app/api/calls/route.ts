import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { CALLS_PAGE, coreCallFilter, readCallFilter, toCallRow } from '@/lib/call-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Хвост журнала вызовов — по курсору «время и номер». Отбор тот же,
 * что на странице, и разбирается одним правилом (`readCallFilter`).
 * Права спрашивает операция: журнал открыт тому же, кому страница.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    const filter = readCallFilter((name) => params.get(name) ?? undefined);
    const after = params.get('after');
    const afterId = params.get('afterId');

    const rows = await getCore().listApiRequestLog(actor, {
      limit: CALLS_PAGE,
      ...coreCallFilter(filter),
      ...(after && afterId && !Number.isNaN(Date.parse(after))
        ? { after: { at: new Date(after), id: afterId } }
        : {}),
    });

    return json({ rows: rows.map(toCallRow) });
  } catch (error) {
    return errorResponse(error);
  }
}
