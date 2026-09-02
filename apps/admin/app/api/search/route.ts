import type { ManagerExchangeRequestView } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { classifyQuery } from '@/lib/palette';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Поиск для палитры быстрого перехода.
 *
 * Ищет там же, где сужает стол: в очереди и среди заявок в работе, тем
 * же фильтром по нику и ID клиента. Исполненные и отменённые сюда не
 * попадают — операции поиска по всем состояниям в ядре нет; появится
 * вместе с разделом клиентов, и палитра расширится.
 *
 * Десять строк на ответ: палитра — для перехода, а не для чтения
 * списка, и больше десяти совпадений значит, что набрано мало.
 */
const LIMIT = 5;

export interface SearchHit {
  readonly id: string;
  readonly fromAmount: string;
  readonly fromCode: string;
  readonly toAmount: string | null;
  readonly toCode: string;
  readonly status: ManagerExchangeRequestView['status'];
  readonly clientUsername: string | null;
  readonly clientId: string;
  readonly assignedManagerName: string | null;
}

export interface ClientHit {
  readonly id: string;
  readonly username: string | null;
  readonly completed: number;
  readonly regular: boolean;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = classifyQuery(new URL(request.url).searchParams.get('q') ?? '');
    if (parsed.kind !== 'search') {
      return json({ hits: [], clients: [] });
    }

    const core = getCore();
    const [queue, working, clients] = await Promise.all([
      core.listExchangeRequestQueue(actor, { query: parsed.query, limit: LIMIT }),
      core.listExchangeRequestsInProgress(actor, { query: parsed.query, limit: LIMIT }),
      // Клиенты — по нику или ID, из раздела «Клиенты»: с ними палитра
      // находит и тех, у кого сейчас нет открытой заявки.
      core.listClients(actor, { query: parsed.query, limit: LIMIT }),
    ]);

    const hits: SearchHit[] = [...queue, ...working].map((one) => ({
      id: one.id,
      fromAmount: one.fromAmount,
      fromCode: one.fromCode,
      toAmount: one.toAmount,
      toCode: one.toCode,
      status: one.status,
      clientUsername: one.clientUsername,
      clientId: one.clientId.toString(),
      assignedManagerName: one.assignedManagerName,
    }));
    const found: ClientHit[] = clients.map((one) => ({
      id: one.telegramUserId.toString(),
      username: one.username,
      completed: one.completed,
      regular: one.regular,
    }));
    return json({ hits, clients: found });
  } catch (error) {
    return errorResponse(error);
  }
}
