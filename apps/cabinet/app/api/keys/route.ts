import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { deliverMail } from '@/lib/mail';
import { toKeyRow } from '@/lib/key-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Длину и пустоту подписи проверяет ядро — своими словами.
const schema = z.object({ label: z.string() });

/**
 * Выпуск ключа API. Секрет уходит в ответе один раз и нигде больше не
 * появляется: ни в базе, ни в письме, ни в журнале. Письмо о выпуске
 * при этом уходит — тому, кто ключ не выпускал, это повод отозвать.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Подпишите ключ: для чего он');
    }

    const issued = await getCore().issueApiKey(actor, parsed.data);
    await deliverMail(issued.notifications);

    return json({ key: toKeyRow(issued.key), secret: issued.secret }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
