import {
  coreErrorResponse,
  unauthorizedResponse,
  unexpectedErrorResponse,
} from '@nemo/http';
import { botToken } from '@nemo/telegram';
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
  const token = botToken();

  const header = request.headers.get('authorization');
  const raw = header?.startsWith('tma ') ? header.slice(4) : undefined;
  if (!raw) {
    throw new InitDataError('Нет данных запуска Mini App');
  }
  return verifyInitData(raw, token);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof InitDataError) {
    return unauthorizedResponse('Не удалось подтвердить запуск');
  }
  return coreErrorResponse(error) ?? unexpectedErrorResponse(error);
}

export { json } from '@nemo/http';
