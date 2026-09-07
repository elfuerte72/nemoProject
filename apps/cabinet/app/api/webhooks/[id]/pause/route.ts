import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { toEndpointRow } from '@/lib/webhook-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ paused: z.boolean() });

/** Пауза и обратно: доставки за время паузы не пишутся, а не копятся. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Не разобрано: нужно «paused» — да или нет');
    }

    const endpoint = await getCore().setWebhookEndpointPaused(actor, id, parsed.data.paused);
    return json({ endpoint: toEndpointRow(endpoint) });
  } catch (error) {
    return errorResponse(error);
  }
}
