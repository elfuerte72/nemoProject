import {
  coreErrorResponse,
  unauthorizedResponse,
  unexpectedErrorResponse,
} from '@nemo/http';
import { SessionError } from '@/lib/session';

/**
 * Общая часть маршрутов кабинета: что ответить, когда операция отказала.
 *
 * Отказ входа отвечает одинаково и без подробностей — тем же правилом,
 * по которому операция входа не различает «нет такой почты» и «пароль
 * не тот»: разные ответы говорили бы подбирающему, на каком шаге он
 * остановился.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof SessionError) {
    return unauthorizedResponse('Требуется вход');
  }
  return coreErrorResponse(error) ?? unexpectedErrorResponse(error);
}

export { json } from '@nemo/http';
