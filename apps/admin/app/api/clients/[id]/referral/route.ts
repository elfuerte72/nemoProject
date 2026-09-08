import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Клиент в реферальной программе: личные ставки и правка баллов —
 * администратору. Кому можно, решает операция.
 */

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('rates'),
    rates: z.array(z.object({ line: z.number(), rateBps: z.number() })).nullable(),
  }),
  z.object({ action: z.literal('adjust'), amount: z.string(), comment: z.string() }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) {
      throw new InvalidInputError('Клиент не распознан');
    }
    const clientId = BigInt(id);
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Действие не распознано');
    }
    const core = getCore();
    if (parsed.data.action === 'rates') {
      return json({ rates: await core.setClientReferralRates(actor, clientId, parsed.data.rates) });
    }
    return json({
      transaction: await core.adjustBonus(actor, clientId, {
        amount: parsed.data.amount,
        comment: parsed.data.comment,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
