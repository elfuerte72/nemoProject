import { json } from '@nemo/http';
import { getCore } from '@/lib/core';
import { v1 } from '@/lib/v1/route';
import { toApiRequest } from '@/lib/v1/views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Одна заявка. Чужая — «не найдена», и отличать это от несуществующей
 * нельзя: иначе перебором номеров можно узнать, какие есть.
 */
export const GET = v1<{ id: string }>(async (_request, ctx, _body, { id }) => {
  const core = getCore();
  const [request, terms] = await Promise.all([
    core.getExchangeRequest(ctx.actor, id),
    core.getExchangeTerms(),
  ]);
  return json({ request: toApiRequest(request, terms) });
});
