import { z } from 'zod';
import { ForbiddenError, InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { addressOf, attemptAllowed, attemptSpent } from '@/lib/attempts';
import { getCore } from '@/lib/core';
import { deliverMail, requireMail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().max(320) });

/**
 * «Забыли пароль»: письмо со ссылкой на час.
 *
 * Ответ один на знакомую и незнакомую почту — так решает операция, и
 * маршрут это правило не портит: иначе форма стала бы способом
 * перебирать, кто здесь заведён.
 *
 * Число просьб ограничено и по адресу, и по почте: каждая шлёт письмо
 * на чужой ящик, и без предела форма работает почтовой бомбой по
 * известному адресу. Отказ при этом тоже один на всех — он ничего не
 * говорит о том, заведён ли такой кабинет.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireMail();

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Укажите почту');
    }

    const address = addressOf(request);
    const email = parsed.data.email.trim().toLowerCase();
    if (!attemptAllowed(`reset:${address}`) || !attemptAllowed(`reset:${email}`)) {
      throw new ForbiddenError('Слишком много просьб подряд. Попробуйте через четверть часа.');
    }
    attemptSpent(`reset:${address}`);
    attemptSpent(`reset:${email}`);

    const result = await getCore().requestMerchantPasswordReset(email);
    await deliverMail(result.notifications);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
