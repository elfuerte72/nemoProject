import { cookies } from 'next/headers';
import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import { SESSION_COOKIE } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string(), password: z.string() });

/**
 * Новый пароль по ссылке из письма.
 *
 * Сессии при этом обрываются все разом — их обрывает само ядро сменой
 * поколения. Кука здесь снимается следом: она уже не подходит, и
 * оставленная, она отправляла бы человека на страницу входа окольным
 * путём — через отказ на первом же экране.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Ссылка неполная: откройте её из письма целиком');
    }

    await getCore().resetMerchantPassword(parsed.data.token, parsed.data.password);

    const store = await cookies();
    store.delete(SESSION_COOKIE);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
