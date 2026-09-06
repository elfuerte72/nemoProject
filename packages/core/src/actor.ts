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
  | { readonly type: 'merchant'; readonly merchantId: string }
  | { readonly type: 'staff'; readonly staffId: string; readonly role: StaffRole }
  | { readonly type: 'system' };

export function requireClient(actor: Actor): bigint {
  if (actor.type !== 'client') {
    throw new ForbiddenError('Операция доступна только клиенту');
  }
  return actor.telegramUserId;
}

export function requireMerchant(actor: Actor): string {
  if (actor.type !== 'merchant') {
    throw new ForbiddenError('Операция доступна только мерчанту');
  }
  return actor.merchantId;
}

/**
 * Владелец заявки и записи реквизитов — клиент или мерчант
 * (docs/adr/0017).
 *
 * Мерчант опознан сессией кабинета или ключом API, клиент — подписью
 * запуска Mini App; для операции над своим они равны, и различать их
 * ей незачем — иначе «подать заявку» пришлось бы писать дважды, и две
 * копии разошлись бы на первом же правиле о деньгах.
 *
 * Возвращает размеченное объединение, а не пару необязательных полей:
 * `{ clientId?, merchantId? }` разрешал бы вызывающему прочитать оба
 * пустыми и записать заявку без владельца — ту самую, которую база
 * отвергнет ограничением, но уже в проде.
 */
export type Owner =
  | { readonly kind: 'client'; readonly clientId: bigint }
  | { readonly kind: 'merchant'; readonly merchantId: string };

export function requireOwner(actor: Actor): Owner {
  if (actor.type === 'client') {
    return { kind: 'client', clientId: actor.telegramUserId };
  }
  if (actor.type === 'merchant') {
    return { kind: 'merchant', merchantId: actor.merchantId };
  }
  throw new ForbiddenError('Операция доступна только владельцу заявки');
}

export function requireStaff(actor: Actor): { staffId: string; role: StaffRole } {
  if (actor.type !== 'staff') {
    throw new ForbiddenError('Операция доступна только сотруднику');
  }
  return { staffId: actor.staffId, role: actor.role };
}

/**
 * Права администратора: управление сотрудниками и экономикой сервиса,
 * журнал обращений к реквизитам.
 *
 * Отделено от прав менеджера, потому что менеджер — тот, за кем этот
 * журнал и ведётся: доступ к нему у проверяемого обесценивает саму
 * проверку.
 */
export function requireAdmin(actor: Actor): { staffId: string } {
  const staff = requireStaff(actor);
  if (staff.role !== 'admin') {
    throw new ForbiddenError('Операция доступна только администратору');
  }
  return { staffId: staff.staffId };
}
