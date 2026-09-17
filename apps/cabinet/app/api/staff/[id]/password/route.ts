import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ password: z.string() });

/**
 * Новый пароль человеку — от владельца, без знания нынешнего: он его и
 * не знает. Прежние сессии этого человека обрываются, и пароль в ответ
 * не возвращается: его владелец только что набрал сам.
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
      throw new InvalidInputError('Придумайте пароль');
    }

    await getCore().setMerchantUserPassword(actor, id, parsed.data.password);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
