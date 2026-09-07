import { json } from '@nemo/http';
import { getCore } from '@/lib/core';
import { quoteFor } from '@/lib/v1/quote';
import { v1 } from '@/lib/v1/route';
import { parseBody, quoteBodySchema } from '@/lib/v1/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Котировка на сумму — с любой стороны сделки.
 *
 * `quotedAt` из ответа присылается обратно при подаче: заявка уйдёт по
 * показанному курсу, а не по тому, что успел прийти следом
 * (docs/adr/0006). Ссылка живёт пять минут.
 */
export const POST = v1(async (_request, _ctx, raw) => {
  const body = parseBody(quoteBodySchema, raw);
  return json({ quote: await quoteFor(getCore(), body) });
});
