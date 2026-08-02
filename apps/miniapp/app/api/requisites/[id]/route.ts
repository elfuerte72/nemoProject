import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Удаление сохранённого реквизита.
 *
 * На деле — архивирование: на запись ссылаются поданные заявки, и
 * вычеркнуть её из них значило бы стереть, куда ушли деньги. Клиенту это
 * различие не показывается — из списка запись пропадает.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const { id } = await context.params;
    await getCore().archiveRequisites(
      { type: 'client', telegramUserId: initData.telegramUserId },
      id,
    );
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
