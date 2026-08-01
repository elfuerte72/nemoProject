import {
  coreErrorResponse,
  unauthorizedResponse,
  unexpectedErrorResponse,
} from '@nemo/http';
import { SessionError } from '@/lib/auth/session';
import { TelegramLoginError } from '@/lib/auth/telegram-login';

/**
 * Общая часть маршрутов админки: что ответить, когда операция отказала.
 *
 * Отказы аутентификации отвечают одинаково и без подробностей — тем же
 * правилом, по которому операция входа не различает «не сотрудник» и
 * «неверный код».
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof SessionError || error instanceof TelegramLoginError) {
    return unauthorizedResponse('Требуется вход');
  }
  return coreErrorResponse(error) ?? unexpectedErrorResponse(error);
}

export { json } from '@nemo/http';
