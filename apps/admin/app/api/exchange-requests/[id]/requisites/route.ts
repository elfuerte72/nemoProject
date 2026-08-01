import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Полный номер карты клиента по заявке, которую менеджер ведёт.
 *
 * Отдельным запросом, а не полем в карточке заявки: номер не должен
 * уезжать на экран просто потому, что менеджер открыл заявку. Каждое
 * такое обращение попадает в журнал — операция записывает его в той же
 * транзакции, и пропустить запись нельзя.
 *
 * `POST`, а не `GET`: это не чтение справочной величины, а действие с
 * последствием, и кэшировать его нельзя ни браузеру, ни посреднику.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;
    const requisites = await getCore().revealRequisites(actor, id);
    return json({ requisites });
  } catch (error) {
    return errorResponse(error);
  }
}
