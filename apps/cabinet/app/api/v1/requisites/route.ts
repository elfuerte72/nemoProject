import { json } from '@nemo/http';
import { getCore } from '@/lib/core';
import { v1 } from '@/lib/v1/route';
import { parseBody, requisitesBodySchema } from '@/lib/v1/schemas';
import { toApiRequisites } from '@/lib/v1/views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Сохранённые получатели мерчанта — свои реквизиты, на которые он
 * меняет регулярно. Покупателю мерчанта запись заводить не нужно:
 * реквизиты уходят прямо в теле подачи (`payout`) и архивируются сами.
 *
 * Номер карты, адрес и содержимое QR приходят сюда открытыми и дальше
 * в ответах не появляются: наружу — хвосты. Правдоподобие проверяет
 * ядро теми же правилами, что у формы, и отвечает теми же словами.
 */
export const GET = v1(async (_request, ctx) => {
  const rows = await getCore().listRequisites(ctx.actor);
  return json({ items: rows.map(toApiRequisites) });
});

export const POST = v1(async (_request, ctx, raw) => {
  const body = parseBody(requisitesBodySchema, raw);
  const saved = await getCore().saveRequisites(ctx.actor, body);
  return json({ requisites: toApiRequisites(saved) }, { status: 201 });
});
