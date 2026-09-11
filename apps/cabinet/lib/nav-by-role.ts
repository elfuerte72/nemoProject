import { merchantRoleCan, type MerchantAbility, type MerchantUserRole } from '@nemo/types';
import type { NavGroup } from '@nemo/ui/nav';
import { NAV_GROUPS } from './nav';

/**
 * Меню под роль вошедшего (тикет 17 трекера кабинета).
 *
 * Состав разделов один (`NAV_GROUPS`), а видно из него разное, и
 * решает это та же таблица прав, по которой отвечают операции ядра:
 * спрятанная кнопка ничего не запрещает — запрещает операция, — но
 * меню, ведущее в отказ, хуже отсутствующего пункта.
 *
 * Чтение здесь не перечисляется: обзор, заявки, курсы, аналитика,
 * настройки и поддержка видны каждому, кого мерчант завёл. Кабинет —
 * его организация, и прятать от собственного наблюдателя её же числа
 * незачем.
 */

/** Какое право открывает пункт. Не названные здесь видны всем. */
const NEEDS: Readonly<Record<string, MerchantAbility>> = {
  '/requests/new': 'submit',
  '/recipients': 'recipients',
  '/pos': 'till',
  '/refunds': 'till',
  '/keys': 'integration',
  '/webhooks': 'integration',
  '/webhooks/guide': 'integration',
  '/calls': 'integration',
  '/docs': 'integration',
  '/sandbox': 'integration',
  '/staff': 'staff',
};

export function navGroupsFor(role: MerchantUserRole): readonly NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const needs = NEEDS[item.href];
      return needs === undefined || merchantRoleCan(role, needs);
    }),
  }))
    // Заголовок ни над чем читается как поломка: у наблюдателя от
    // «Интеграции» не остаётся ни одного пункта, и самой группы быть
    // не должно.
    .filter((group) => group.items.length > 0);
}
