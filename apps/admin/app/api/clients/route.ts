import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { pickTab, toClientRowDto } from '@/lib/client-rows';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Следующая страница списка клиентов: тот же фильтр, что у раздела,
 * плюс курсор по паре «время регистрации и идентификатор» последней
 * показанной строки.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const params = new URL(request.url).searchParams;
    const after = params.get('after');
    const afterId = params.get('afterId');
    // Время курсора — строкой из базы, как есть: точность до микросекунд.
    const cursor =
      after && afterId && /^\d+$/.test(afterId) && !Number.isNaN(Date.parse(after))
        ? { createdAt: after, id: BigInt(afterId) }
        : undefined;

    const rows = await getCore().listClients(actor, {
      query: params.get('q') ?? undefined,
      tab: pickTab(params.get('tab') ?? undefined),
      ...(cursor ? { after: cursor } : {}),
    });
    return json({ rows: rows.map(toClientRowDto) });
  } catch (error) {
    return errorResponse(error);
  }
}
