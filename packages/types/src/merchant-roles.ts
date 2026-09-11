import { z } from 'zod';

/**
 * Роли людей у мерчанта (тикет 17 трекера кабинета).
 *
 * Мерчант — организация, а входят в кабинет люди, и различаются они тем
 * же, чем различается их работа: кто подаёт заявки и платит, кто только
 * смотрит числа, кто отвечает за то, чем сервис встроен в чужую
 * систему.
 *
 * Ролей три, а не четыре, как у образца: у него кассир, агент,
 * совладелец и под-партнёр, но три последние про счета и партнёрскую
 * сеть, которых у нас в ядре нет, — роль под несуществующую сущность
 * обещает её.
 */
export const merchantUserRoles = [
  'owner', // завёл анкету: отвечает за деньги и за интеграцию
  'operator', // работает: подаёт заявки, ведёт получателей, стоит за кассой
  'viewer', // смотрит: заявки, аналитика, курсы
] as const;
export const merchantUserRoleSchema = z.enum(merchantUserRoles);
export type MerchantUserRole = z.infer<typeof merchantUserRoleSchema>;

/**
 * Что человек делает, а не что ему показать: разделы кабинета
 * скрываются по этим же правилам, но правило одно — иначе спрятанная
 * кнопка и отказ операции разошлись бы, и обойти её удалось бы любым
 * другим путём к той же операции.
 *
 * Чтения здесь нет: обзор, заявки, курсы, аналитику, поддержку и свой
 * пароль видит каждый, кого мерчант завёл. Кабинет — это его
 * организация, и прятать от собственного наблюдателя её же числа
 * незачем.
 */
export const merchantAbilities = [
  'submit', // подать и отменить заявку
  'recipients', // заводить и архивировать получателей
  'till', // касса: счёт покупателю и возврат
  'integration', // ключи API, вебхуки, журнал вызовов, подпись запросов
  'staff', // люди мерчанта: завести, сменить роль, закрыть доступ
] as const;
export const merchantAbilitySchema = z.enum(merchantAbilities);
export type MerchantAbility = z.infer<typeof merchantAbilitySchema>;

/**
 * Таблица прав. Владелец назван перечислением всего, а не признаком
 * «может всё»: новая способность должна заставить дописать сюда строку,
 * а не достаться ему молча.
 */
const ABILITIES: Readonly<Record<MerchantUserRole, readonly MerchantAbility[]>> = {
  owner: ['submit', 'recipients', 'till', 'integration', 'staff'],
  /*
   * Ключей у оператора нет намеренно: ключ API — это право подать
   * заявку от имени мерчанта без пароля, то есть тот же доступ,
   * выданный машине, и раздаёт его тот, кто отвечает за деньги.
   */
  operator: ['submit', 'recipients', 'till'],
  viewer: [],
};

export function merchantRoleCan(role: MerchantUserRole, ability: MerchantAbility): boolean {
  return ABILITIES[role].includes(ability);
}

const ROLE_NAMES: Readonly<Record<MerchantUserRole, string>> = {
  owner: 'Владелец',
  operator: 'Оператор',
  viewer: 'Наблюдатель',
};

export function merchantRoleName(role: MerchantUserRole): string {
  return ROLE_NAMES[role];
}

/**
 * Чем отказывают человеку мерчанта — словами, одними на операцию и на
 * форму кабинета, как `MERCHANT_COMPLAINTS`.
 */
export const MERCHANT_STAFF_COMPLAINTS = {
  name: 'Имя — то, по которому его узнают в списке заявок',
  ownerRole: 'Владелец у кабинета один, и роль ему не меняется',
  ownerAccess: 'Владельцу доступ не закрывается: кабинет остался бы без хозяина',
  ownerPassword: 'Себе пароль меняют в настройках — там спрашивают нынешний',
  notFound: 'Такого человека в кабинете нет',
} as const;

/**
 * Чем отказывает операция, которой роль не даёт права. Называет, кого
 * просить: отказ, не говорящий, что делать вместо, оставляет человека
 * перед закрытой дверью без адреса.
 */
const ABILITY_COMPLAINTS: Readonly<Record<MerchantAbility, string>> = {
  submit: 'Наблюдатель заявки не подаёт: попросите оператора или владельца',
  recipients: 'Наблюдатель получателей не ведёт: попросите оператора или владельца',
  till: 'Наблюдатель кассой не пользуется: попросите оператора или владельца',
  integration: 'Ключи, вебхуки и подпись запросов ведёт владелец кабинета',
  staff: 'Людей кабинета ведёт его владелец',
};

export function merchantAbilityComplaint(ability: MerchantAbility): string {
  return ABILITY_COMPLAINTS[ability];
}
