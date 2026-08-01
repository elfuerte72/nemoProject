import { cookies } from 'next/headers';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import {
  issueToken,
  PENDING_TTL_SECONDS,
  SESSION_COOKIE,
  sessionSecret,
} from '@/lib/auth/session';
import { botToken } from '@nemo/telegram';
import { parseLoginPayload, verifyTelegramLogin } from '@/lib/auth/telegram-login';

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
    const payload = parseLoginPayload(await request.json());
    const login = verifyTelegramLogin(payload, botToken());
    const { staffId } = await getCore().beginStaffLogin(login.telegramUserId);

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

    // Секрет второго фактора отсюда не выдаётся: его заводит
    // администратор при заведении сотрудника и передаёт лично. Секрет,
    // который появлялся бы при первом входе, отдал бы админку тому, кто
    // угнал аккаунт раньше самого сотрудника.
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
