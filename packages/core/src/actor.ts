import type { StaffRole } from '@nemo/types';
import { ForbiddenError } from './errors.js';

/**
 * Тот, от чьего лица выполняется операция.
 *
 * Операция получает исполнителя вместе с данными и сама решает, что ему
 * позволено. Проверка прав в маршруте означала бы, что второй маршрут,
 * вызывающий ту же операцию, может её не сделать.
 *
 * Клиент опознан по подписанным данным запуска Mini App, сотрудник — по
 * сессии админки. Собрать `Actor` из непроверенного запроса — ошибка
 * адаптера, и её ничем, кроме внимательности, не поймать: именно
 * поэтому оба пути проверки подписи покрыты тестами.
 */
export type Actor =
  | { readonly type: 'client'; readonly telegramUserId: bigint }
  | { readonly type: 'staff'; readonly staffId: string; readonly role: StaffRole }
  | { readonly type: 'system' };

export function requireClient(actor: Actor): bigint {
  if (actor.type !== 'client') {
    throw new ForbiddenError('Операция доступна только клиенту');
  }
  return actor.telegramUserId;
}

export function requireStaff(actor: Actor): { staffId: string; role: StaffRole } {
  if (actor.type !== 'staff') {
    throw new ForbiddenError('Операция доступна только сотруднику');
  }
  return { staffId: actor.staffId, role: actor.role };
}
