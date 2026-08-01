import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { cardApplicationStatusSchema } from '@nemo/types';
import { botToken, deliverNotifications } from '@nemo/telegram';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Менеджер ведёт статус заявки на карту по ответам провайдера. */
const updateSchema = z.object({
  status: cardApplicationStatusSchema,
  providerReference: z.string().max(100).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Состояние заявки на карту не распознано');
    }

    const result = await getCore().updateCardApplicationStatus(actor, id, parsed.data);
    await deliverNotifications(result.notifications, { botToken: botToken() });

    return json({ application: result.application });
  } catch (error) {
    return errorResponse(error);
  }
}
