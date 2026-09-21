import { cursorFromParams } from '@nemo/ui/paging';
import { errorResponse, json } from '@/lib/api';
import { requireViewer } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { pickTab, REQUESTS_PAGE, statusesOf, toRequestRow } from '@/lib/request-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Хвост списка заявок — по курсору.
 *
 * Отбор здесь тот же, что на странице, и берётся он из одного места:
 * два правила отбора для первой страницы и для остальных разошлись бы
 * при первой правке, а заметить это можно только на второй странице.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { actor } = await requireViewer();
    const params = new URL(request.url).searchParams;
    const tab = pickTab(params.get('tab') ?? undefined);
    const cursor = cursorFromParams(params);
    const statuses = statusesOf(tab);

    const rows = await getCore().listExchangeRequests(actor, {
      limit: REQUESTS_PAGE,
      ...(statuses ? { statuses } : {}),
      ...(cursor ? { after: { createdAt: new Date(cursor.createdAt), id: cursor.id } } : {}),
    });

    return json({ rows: rows.map(toRequestRow) });
  } catch (error) {
    return errorResponse(error);
  }
}
