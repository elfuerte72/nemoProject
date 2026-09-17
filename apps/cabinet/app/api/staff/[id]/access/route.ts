import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ allowed: z.boolean() });

/**
 * Закрыть доступ и открыть обратно. Закрытие обрывает сессии человека в
 * ту же секунду — поколением, тем же полем, которым их обрывает смена
 * пароля.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Скажите, закрыть доступ или открыть');
    }

    const user = await getCore().setMerchantUserAccess(actor, id, parsed.data);
    return json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}
