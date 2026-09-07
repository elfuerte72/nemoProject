import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { webhookEvents } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { toEndpointRow } from '@/lib/webhook-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  url: z.string(),
  events: z.array(z.enum(webhookEvents)),
});

/**
 * Новая точка. Секрет уходит в ответе один раз: им приёмник проверяет
 * подпись, и второго показа нет — утёкший меняют, заводя точку заново.
 * Адрес и события проверяет ядро своими словами.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Нужны адрес и список событий');
    }

    const added = await getCore().addWebhookEndpoint(actor, parsed.data);
    return json({ endpoint: toEndpointRow(added.endpoint), secret: added.secret }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
