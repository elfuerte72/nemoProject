import { CoreError } from '@nemo/core';
import { SessionError } from '@/lib/auth/session';
import { TelegramLoginError } from '@/lib/auth/telegram-login';

/**
 * Общая часть маршрутов админки: что ответить, когда операция отказала.
 *
 * Отказы аутентификации отвечают одинаково и без подробностей — тем же
 * правилом, по которому операция входа не различает «не сотрудник» и
 * «неверный код».
 */

const STATUS_BY_CODE = {
  'not-found': 404,
  forbidden: 403,
  'invalid-input': 422,
  'transition-not-allowed': 409,
  conflict: 409,
} as const;

export function errorResponse(error: unknown): Response {
  if (error instanceof SessionError || error instanceof TelegramLoginError) {
    return Response.json({ error: 'Требуется вход' }, { status: 401 });
  }
  if (error instanceof CoreError) {
    return Response.json({ error: error.message }, { status: STATUS_BY_CODE[error.code] });
  }
  console.error(error);
  return Response.json({ error: 'Внутренняя ошибка' }, { status: 500 });
}

/** JSON без потери точности: суммы — строки, идентификаторы — bigint. */
export function json(payload: unknown, init?: ResponseInit): Response {
  const body = JSON.stringify(payload, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  return new Response(body, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}
