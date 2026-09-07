import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ required: z.boolean() });

/**
 * Требовать ли подпись HMAC у запросов к API. Включённая обязательна
 * для каждого вызова — об этом сказано рядом с тумблером, а не после
 * первого 401.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Не разобрано: нужно «required» — да или нет');
    }

    const required = await getCore().setSignatureRequired(actor, parsed.data.required);
    return json({ required });
  } catch (error) {
    return errorResponse(error);
  }
}
