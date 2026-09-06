import { ForbiddenError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { addressOf, attemptAllowed, attemptSpent } from '@/lib/attempts';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { deliverMail, requireMail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Письмо подтверждения заново.
 *
 * Просит вошедший, а не всякий, кто назвал адрес: так маршрут не
 * становится способом слать письма на чужие ящики и перебирать, кто
 * здесь заведён. Вход подтверждения не требует — потому и просит.
 *
 * Число просьб ограничено: письмо каждый раз настоящее, и без предела
 * кнопка «выслать заново» работала бы рассылкой по своему же адресу.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireMail();
    const actor = await requireActor();

    const key = `resend:${actor.merchantId}:${addressOf(request)}`;
    if (!attemptAllowed(key)) {
      throw new ForbiddenError('Письмо уже отправлено. Подождите четверть часа.');
    }
    attemptSpent(key);

    const result = await getCore().resendMerchantEmailVerification(actor);
    await deliverMail(result.notifications);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
