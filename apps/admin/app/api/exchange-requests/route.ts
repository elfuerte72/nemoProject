import { exchangeKinds, inProgressExchangeStatuses } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { coreFilterFor, deskScopes, toExchangeRow, type DeskScope } from '@/lib/exchange-rows';
import { cursorFromParams } from '@/lib/paging';
import { pageSizes } from '@/lib/table-prefs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Следующая страница раздела стола.
 *
 * Те же операции и тот же фильтр, что у страницы, плюс курсор
 * последней показанной строки. Отдельный маршрут, а не перерисовка
 * страницы с большим пределом: дочитанное дописывается к показанному,
 * и первые полсотни строк не перечитываются ради следующих пятидесяти.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const params = new URL(request.url).searchParams;
    const scope = pick(params.get('scope') ?? '', deskScopes);
    if (!scope) {
      return json({ rows: [] });
    }
    const filter = coreFilterFor(scope, {
      q: (params.get('q') ?? '').trim(),
      kind: pick(params.get('kind') ?? '', exchangeKinds) ?? '',
      status: pick(params.get('status') ?? '', inProgressExchangeStatuses) ?? '',
    });
    const cursor = cursorFromParams(params);
    const limit = pick(params.get('limit') ?? '', pageSizes.map(String));
    const paged = {
      ...filter,
      ...(limit ? { limit: Number(limit) } : {}),
      ...(cursor ? { after: { createdAt: new Date(cursor.createdAt), id: cursor.id } } : {}),
    };

    const core = getCore();
    const rows =
      scope === 'queue'
        ? await core.listExchangeRequestQueue(actor, paged)
        : await core.listExchangeRequestsInProgress(actor, paged);

    return json({ rows: rows.map(toExchangeRow) });
  } catch (error) {
    return errorResponse(error);
  }
}

function pick<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export type { DeskScope };
