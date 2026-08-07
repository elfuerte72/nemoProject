import { cookies } from 'next/headers';
import { z } from 'zod';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import { devLoginAllowedHere } from '@/lib/auth/dev-login';
import {
  DEFAULT_TTL_SECONDS,
  issueToken,
  SESSION_COOKIE,
  sessionSecret,
  SessionError,
} from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Вход в панель на своей машине.
 *
 * Telegram Login на `localhost` не работает: виджет требует настоящий
 * домен и отвечает «Bot domain invalid». Этот маршрут пропускает оба
 * фактора — подпись Telegram и одноразовый код, — но не проверку, кто
 * входит: сотрудника ищет `beginStaffLogin`, та же операция, которой
 * пользуется настоящий вход, и отказывает она одинаково — незаведённому,
 * отключённому и тому, кому не выдан ключ.
 *
 * Разрешение проверяется здесь, а не только на экране: экран решает,
 * показывать ли кнопку, а маршрут — пускать ли. Кнопка, которой нет,
 * никого не останавливает — адрес набирается руками.
 */

const schema = z.object({ telegramUserId: z.string().regex(/^\d{1,19}$/) });

export async function POST(request: Request): Promise<Response> {
  try {
    if (!devLoginAllowedHere()) {
      // Тем же отказом, что и всякий неудавшийся вход: маршрут, который
      // на живом сервисе отвечает «выключено», сообщает, что он есть.
      throw new SessionError('Требуется вход');
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new SessionError('Нужен числовой Telegram ID сотрудника');
    }

    const staff = await getCore().beginStaffLogin(BigInt(parsed.data.telegramUserId));
    const store = await cookies();
    store.set(
      SESSION_COOKIE,
      issueToken({ staffId: staff.staffId, stage: 'active' }, { secret: sessionSecret() }),
      {
        httpOnly: true,
        sameSite: 'lax',
        // На своей машине панель открывается по http, и `secure`
        // отбросил бы куку молча.
        secure: false,
        path: '/',
        maxAge: DEFAULT_TTL_SECONDS,
      },
    );

    return json({ role: staff.role });
  } catch (error) {
    return errorResponse(error);
  }
}
