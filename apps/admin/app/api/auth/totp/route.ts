import { cookies } from 'next/headers';
import { z } from 'zod';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import {
  DEFAULT_TTL_SECONDS,
  issueToken,
  readToken,
  SESSION_COOKIE,
  sessionSecret,
  SessionError,
} from '@/lib/auth/session';
import { withTotpAttempts } from '@/lib/auth/totp-attempts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const codeSchema = z.object({ code: z.string().min(1).max(12) });

/**
 * Второй шаг входа: одноразовый код.
 *
 * Только он превращает незавершённый вход в сессию. Пропустить шаг,
 * подправив куку, нельзя: ступень входа покрыта той же подписью, что и
 * идентификатор сотрудника.
 *
 * Коды считаются (`lib/auth/totp-attempts.ts`): после пяти промахов за
 * четверть часа ядро до её конца не спрашивается вовсе. О закрытом входе
 * в журнал ложится строка — по ней администратор узнаёт, что у
 * сотрудника подбирали код, то есть первый фактор уже у чужого.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const store = await cookies();
    const pending = readToken(store.get(SESSION_COOKIE)?.value, { secret: sessionSecret() });
    if (pending.stage !== 'pending') {
      throw new SessionError('Вход уже завершён или не начинался');
    }

    const parsed = codeSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new SessionError('Код не передан');
    }

    const session = await withTotpAttempts(
      pending.staffId,
      () => getCore().completeStaffLogin(pending.staffId, parsed.data.code),
      Date.now(),
      () =>
        console.warn(
          `Вход сотрудника ${pending.staffId} закрыт до конца четверти часа от первого промаха: исчерпаны попытки кода второго фактора`,
        ),
    );

    store.set(
      SESSION_COOKIE,
      issueToken({ staffId: session.staffId, stage: 'active' }, { secret: sessionSecret() }),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: DEFAULT_TTL_SECONDS,
      },
    );

    return json({ role: session.role });
  } catch (error) {
    return errorResponse(error);
  }
}
