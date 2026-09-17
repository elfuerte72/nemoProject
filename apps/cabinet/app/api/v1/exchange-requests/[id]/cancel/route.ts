import { json } from '@nemo/http';
import { getCore } from '@/lib/core';
import { deliverMail } from '@/lib/mail';
import { requireRequestId } from '@/lib/v1/ids';
import { v1 } from '@/lib/v1/route';
import { toApiRequest } from '@/lib/v1/views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Отмена своей заявки — пока её не взяли в работу. Дальше отменяет
 * менеджер: деньги уже могли уйти. Правило ядра, и ответ его словами.
 */
export const POST = v1<{ id: string }>(async (_request, ctx, _body, { id }) => {
  const core = getCore();
  const result = await core.cancelOwnExchangeRequest(ctx.actor, requireRequestId(id));
  await deliverMail(result.notifications);

  const terms = await core.getExchangeTerms();
  return json({ request: toApiRequest(result.request, terms) });
});
