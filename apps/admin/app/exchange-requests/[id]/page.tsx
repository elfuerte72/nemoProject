import { redirect } from 'next/navigation';
import { requireStaffActor } from '@/lib/auth/require-session';
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
  const actor = await requireStaffActor().catch(() => undefined);
  if (!actor) {
    redirect('/login');
  }

  const { id } = await params;
  const core = getCore();
  const [request, events] = await Promise.all([
    core.getExchangeRequestForStaff(actor, id),
    core.listExchangeRequestEvents(actor, id),
  ]);

  return (
    <ExchangeRequestCard
      request={{ ...request, clientId: request.clientId.toString() }}
      events={events}
    />
  );
}
