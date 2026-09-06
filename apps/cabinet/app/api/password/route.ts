import { cookies } from 'next/headers';
import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { SESSION_COOKIE } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ currentPassword: z.string(), newPassword: z.string() });

/**
 * Смена пароля. Обрывает все сессии разом — в том числе текущую: это и
 * есть смысл поколения, и кабинет после смены просит войти заново.
 *
 * Кука снимается здесь же: оставленная, она не подошла бы, и мерчант
 * узнал бы об этом отказом на следующем экране вместо ответа формы.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Заполните оба поля');
    }

    await getCore().changeMerchantPassword(actor, parsed.data);

    const store = await cookies();
    store.delete(SESSION_COOKIE);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
