import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Премиальные партнёры: завести амбассадора, снять отметку, вернуть.
 * Кому это можно, решает операция, а не маршрут.
 */

const telegramId = z
  .string()
  .trim()
  .regex(/^\d{1,19}$/, 'Telegram ID — только цифры');

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    telegramUserId: telegramId,
    title: z.string(),
    note: z.string().optional(),
  }),
  z.object({ action: z.literal('revoke'), telegramUserId: telegramId }),
  z.object({ action: z.literal('restore'), telegramUserId: telegramId }),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? 'Действие не распознано');
    }
    const core = getCore();
    const clientId = BigInt(parsed.data.telegramUserId);

    if (parsed.data.action === 'add') {
      return json({
        ambassador: await core.addAmbassador(actor, {
          telegramUserId: clientId,
          title: parsed.data.title,
          note: parsed.data.note,
        }),
      });
    }
    if (parsed.data.action === 'revoke') {
      return json({ ambassador: await core.revokeAmbassador(actor, clientId) });
    }
    return json({ ambassador: await core.restoreAmbassador(actor, clientId) });
  } catch (error) {
    return errorResponse(error);
  }
}
