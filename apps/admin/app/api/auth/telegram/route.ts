import { cookies } from 'next/headers';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import {
  issueToken,
  PENDING_TTL_SECONDS,
  SESSION_COOKIE,
  sessionSecret,
} from '@/lib/auth/session';
import { verifyTelegramLogin } from '@/lib/auth/telegram-login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Первый шаг входа: Telegram Login.
 *
 * Подпись подтверждает владение аккаунтом, список сотрудников — право
 * войти. Сессия по итогам этого шага не выдаётся: кука помечена как
 * незавершённый вход и живёт пять минут — ровно столько, сколько нужно
 * на ввод одноразового кода.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('Не задан TELEGRAM_BOT_TOKEN');
    }

    const payload = (await request.json()) as Record<string, string>;
    const login = verifyTelegramLogin(payload, token);
    const { staffId, enrollmentSecret } = await getCore().beginStaffLogin(login.telegramUserId);

    const store = await cookies();
    store.set(SESSION_COOKIE, issueToken({ staffId, stage: 'pending' }, {
      secret: sessionSecret(),
      ttlSeconds: PENDING_TTL_SECONDS,
    }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: PENDING_TTL_SECONDS,
    });

    // Секрет второго фактора показывается один раз — при первом входе.
    // Дальше он не возвращается ни при каких обстоятельствах.
    return json({ enrollmentSecret });
  } catch (error) {
    return errorResponse(error);
  }
}
