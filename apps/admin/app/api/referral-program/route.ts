import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Реферальная программа: линии, уровни (docs/adr/0021).
 *
 * Один маршрут на три действия, как у решений о мерчанте: что можно и
 * кому, решает операция, и разносить это по адресам значило бы
 * описывать дважды. Менеджер получает отказ ядра, а не скрытую кнопку.
 */

const rateSchema = z.object({ line: z.number(), rateBps: z.number() });

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('lines'), lines: z.array(rateSchema) }),
  z.object({
    action: z.literal('tier'),
    id: z.string().optional(),
    name: z.string(),
    minActiveReferrals: z.number(),
    rates: z.array(rateSchema),
  }),
  z.object({ action: z.literal('delete-tier'), id: z.string() }),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Действие не распознано');
    }
    const input = parsed.data;
    const core = getCore();
    switch (input.action) {
      case 'lines':
        return json({ program: await core.updateReferralLines(actor, input.lines) });
      case 'tier':
        return json({
          tier: await core.upsertReferralTier(actor, {
            ...(input.id === undefined ? {} : { id: input.id }),
            name: input.name,
            minActiveReferrals: input.minActiveReferrals,
            rates: input.rates,
          }),
        });
      case 'delete-tier':
        await core.deleteReferralTier(actor, input.id);
        return json({ ok: true });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
