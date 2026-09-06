import { cookies } from 'next/headers';
import { z } from 'zod';
import { ForbiddenError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import {
  addressOf,
  attemptAllowed,
  attemptSpent,
  attemptSucceeded,
} from '@/lib/attempts';
import { getCore } from '@/lib/core';
import {
  issueToken,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  sessionSecret,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string(), password: z.string() });

/**
 * Вход по почте и паролю.
 *
 * Попытки считаются и по почте, и по адресу: по почте — чтобы не
 * подбирали пароль к одному кабинету, по адресу — чтобы не перебирали
 * почты списком. Отказ при этом один на всё — «почта или пароль не
 * подходят», «слишком много попыток»: разные ответы говорили бы
 * подбирающему, на каком шаге он остановился.
 *
 * Состояние мерчанта вход не проверяет: отклонённый и отключённый
 * входят — первому надо прочитать причину, второму дождаться своих
 * открытых заявок. Что им можно делать, решают операции.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ForbiddenError('Почта или пароль не подходят');
    }

    const email = parsed.data.email.trim().toLowerCase();
    const address = addressOf(request);
    if (!attemptAllowed(email) || !attemptAllowed(address)) {
      throw new ForbiddenError('Слишком много попыток входа. Попробуйте через четверть часа.');
    }

    let session;
    try {
      session = await getCore().beginMerchantLogin({ email, password: parsed.data.password });
    } catch (error) {
      // Считается неподошедший пароль, а не всякая неудача: отказавшая
      // база — это не попытка подбора, и запирать за неё вход на
      // четверть часа значило бы к недоступной базе добавить
      // недоступный кабинет.
      if (error instanceof ForbiddenError) {
        attemptSpent(email);
        attemptSpent(address);
      }
      throw error;
    }

    attemptSucceeded(email);
    attemptSucceeded(address);

    const store = await cookies();
    store.set(
      SESSION_COOKIE,
      issueToken(
        { merchantId: session.merchantId, sessionEpoch: session.sessionEpoch },
        { secret: sessionSecret() },
      ),
      SESSION_COOKIE_OPTIONS,
    );

    return json({ status: session.status });
  } catch (error) {
    return errorResponse(error);
  }
}
