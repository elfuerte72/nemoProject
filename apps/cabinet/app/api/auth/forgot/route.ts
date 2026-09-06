import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import { deliverMail, requireMail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string() });

/**
 * «Забыли пароль»: письмо со ссылкой на час.
 *
 * Ответ один на знакомую и незнакомую почту — так решает операция, и
 * маршрут это правило не портит: иначе форма стала бы способом
 * перебирать, кто здесь заведён.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireMail();

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Укажите почту');
    }

    const result = await getCore().requestMerchantPasswordReset(parsed.data.email);
    await deliverMail(result.notifications);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
