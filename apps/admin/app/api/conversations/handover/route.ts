import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { telegramUserIdSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Кто ведёт разговор — помощник или человек.
 *
 * Обе стороны одним маршрутом: это одна настройка с двумя значениями, и
 * два адреса под неё разошлись бы в правах и проверках.
 *
 * Клиенту об этом не сообщается ничем: переключение — забота сервиса, а
 * не событие в его переписке. Он заметит его по тому, кто ответит
 * следующим.
 */
const handoverSchema = z.object({
  clientId: telegramUserIdSchema,
  /** Ведёт человек. Снятое — разговор возвращается помощнику. */
  toHuman: z.boolean(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = handoverSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Не разобрано, кому передавать разговор');
    }

    const core = getCore();
    if (parsed.data.toHuman) {
      await core.handOverToHuman(actor, parsed.data.clientId);
    } else {
      await core.returnToConcierge(actor, parsed.data.clientId);
    }

    return json({ handedToHuman: parsed.data.toHuman });
  } catch (error) {
    return errorResponse(error);
  }
}
