import { CoreError } from '@nemo/core';
import { InitDataError, verifyInitData, type InitData } from '@/lib/telegram/init-data';

/**
 * Общая часть маршрутов клиентского приложения: кто пришёл и что
 * ответить, когда операция отказала.
 *
 * Маршрут остаётся тонким — разобрать запрос, вызвать операцию, отдать
 * результат. Правила предметной области сюда не переезжают: маршрутов
 * много, и правило, размазанное по ним, рано или поздно в одном из них
 * отстанет.
 */

/**
 * Клиент, от чьего лица идёт запрос.
 *
 * `telegram_user_id` берётся исключительно из подписанных данных
 * запуска. Присланный в теле запроса идентификатор игнорируется:
 * подставить туда чужой может кто угодно.
 */
export function requireInitData(request: Request): InitData {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('Не задан TELEGRAM_BOT_TOKEN');
  }

  const header = request.headers.get('authorization');
  const raw = header?.startsWith('tma ') ? header.slice(4) : undefined;
  if (!raw) {
    throw new InitDataError('Нет данных запуска Mini App');
  }
  return verifyInitData(raw, token);
}

const STATUS_BY_CODE = {
  'not-found': 404,
  forbidden: 403,
  'invalid-input': 422,
  'transition-not-allowed': 409,
  conflict: 409,
} as const;

export function errorResponse(error: unknown): Response {
  if (error instanceof InitDataError) {
    // Подробностей клиенту не сообщаем: они помогли бы подбирать подпись.
    return Response.json({ error: 'Не удалось подтвердить запуск' }, { status: 401 });
  }
  if (error instanceof CoreError) {
    return Response.json({ error: error.message }, { status: STATUS_BY_CODE[error.code] });
  }
  console.error(error);
  return Response.json({ error: 'Внутренняя ошибка' }, { status: 500 });
}

/**
 * JSON без потери точности: `telegram_user_id` и денежные величины —
 * bigint и строки, и `JSON.stringify` на первом же bigint бросает.
 */
export function json(payload: unknown, init?: ResponseInit): Response {
  const body = JSON.stringify(payload, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  return new Response(body, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}
