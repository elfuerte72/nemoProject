import { cookies } from 'next/headers';
import { botToken } from '@nemo/telegram';
import { parseLoginPayload, verifyTelegramLogin } from '@nemo/telegram/login';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import {
  AMBASSADOR_COOKIE,
  AMBASSADOR_COOKIE_OPTIONS,
  issueAmbassadorToken,
} from '@/lib/ambassador-session';
import { sessionSecret } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Вход амбассадора: подпись Telegram и отметка в программе.
 *
 * Подпись подтверждает владение аккаунтом и не больше — право войти
 * даёт отметка, и решает это ядро (`signInAmbassador`). Токен здесь
 * клиентского бота: подписывает тот бот, чей виджет нажали, а виджет на
 * витрине его.
 *
 * Второго фактора у амбассадора нет: TOTP стоит у сотрудника потому,
 * что сотрудник видит чужие деньги и чужие реквизиты, а амбассадор —
 * только свои числа.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const payload = parseLoginPayload(await request.json());
    const login = verifyTelegramLogin(payload, botToken());

    const session = await getCore().signInAmbassador(login.telegramUserId);

    (await cookies()).set(
      AMBASSADOR_COOKIE,
      issueAmbassadorToken({ clientId: session.clientId }, { secret: sessionSecret() }),
      AMBASSADOR_COOKIE_OPTIONS,
    );
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
