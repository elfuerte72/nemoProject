import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { botToken, deliverNotifications } from '@nemo/telegram';
import { telegramUserIdSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ответ менеджера клиенту.
 *
 * Доставляет его клиентский бот — тот, которого клиент запускал сам:
 * менеджер со своего аккаунта не смог бы написать первым тому, у кого
 * закрыты личные сообщения, а бот доходит всегда.
 */
const replySchema = z.object({
  clientId: telegramUserIdSchema,
  body: z.string().min(1).max(4000),
  exchangeRequestId: z.string().uuid().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = replySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Ответ не распознан');
    }

    const { message, notifications } = await getCore().replyToClient(actor, parsed.data);
    await deliverNotifications(notifications, { botToken: botToken() });

    return json({ message }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
