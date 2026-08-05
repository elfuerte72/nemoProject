import { cookies } from 'next/headers';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import {
  issueToken,
  PENDING_TTL_SECONDS,
  SESSION_COOKIE,
  sessionSecret,
} from '@/lib/auth/session';
import { enrollmentQr } from '@/lib/auth/enrollment';
import { loginBotToken } from '@/lib/auth/login-bot';
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
 *
 * Вместе с ответом уходит и выданный ключ второго фактора — но только
 * пока им ни разу не входили. Ядро решает, отдавать ли его
 * (`packages/core/src/staff.ts`); здесь он лишь превращается в код для
 * камеры. Отдельным маршрутом это не сделано намеренно: второй маршрут,
 * отдающий второй фактор, — второе место, где можно ошибиться с
 * проверкой ступени входа.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const payload = parseLoginPayload(await request.json());
    // Токен бота с кнопкой входа, а не клиентского: подпись строит тот
    // бот, чей виджет нажали.
    const login = verifyTelegramLogin(payload, loginBotToken());
    const core = getCore();
    const { staffId, secondFactorPending } = await core.beginStaffLogin(login.telegramUserId);

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

    /*
     * Ответ несёт второй фактор целиком, и осесть в хранилище по дороге
     * он не должен. Ответы на POST по умолчанию и так никто не кэширует,
     * но здесь цена ошибки — чужой второй фактор, а запрет стоит строки.
     */
    const noStore = { headers: { 'cache-control': 'no-store' } };

    if (!secondFactorPending) {
      return json({ ok: true }, noStore);
    }

    const enrollment = await core.claimSecondFactor(staffId);
    return json(
      {
        ok: true,
        enrollment: {
          secret: enrollment.enrollmentSecret,
          qr: await enrollmentQr(enrollment.otpauthUri),
        },
      },
      noStore,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
