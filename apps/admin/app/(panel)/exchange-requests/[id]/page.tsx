import { notFound, redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { ExchangeRequestCard } from './exchange-request-card';

export const dynamic = 'force-dynamic';

/**
 * Карточка заявки: всё, что менеджеру нужно знать и сделать, на одном
 * экране — состояние, история переходов и доступные действия.
 */
export default async function RequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const { id } = await params;
  const core = getCore();

  /*
   * Заявки с таким идентификатором нет — это «не найдено», а не авария:
   * адрес мог остаться в закладке от удалённой заявки или быть набран
   * руками. Страница ошибки на такое пугает менеджера сильнее, чем
   * стоило бы. Всё остальное пробрасывается: отказавшая база — как раз
   * авария, и прятать её за «не найдено» значит её потерять.
   */
  const [request, events, templates] = await Promise.all([
    core.getExchangeRequestForStaff(actor, id),
    core.listExchangeRequestEvents(actor, id),
    core.listTextTemplates(actor),
  ]).catch((error: unknown) => {
    if (error instanceof CoreError && error.code === 'not-found') {
      notFound();
    }
    throw error;
  });

  return (
    <ExchangeRequestCard
      request={{ ...request, clientId: request.clientId.toString() }}
      events={events}
      templates={templates}
      viewerStaffId={actor.staffId}
    />
  );
}
