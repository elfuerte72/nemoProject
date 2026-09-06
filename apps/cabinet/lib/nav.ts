import type { NavGroup } from '@nemo/ui/nav';

/**
 * Карта разделов кабинета мерчанта.
 *
 * Форма списка и правила меню — общие с панелью и живут в `@nemo/ui`;
 * здесь только состав. Раздел заводится одной строкой массива.
 *
 * Порядок отвечает на вопросы по мере их появления: что у меня
 * происходит, что с моими заявками, чем это делать программно, кто я
 * такой и куда писать, если что-то не так.
 */

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'work',
    title: 'Работа',
    items: [
      { href: '/', label: 'Обзор', icon: 'home' },
      { href: '/requests', label: 'Заявки', icon: 'exchange', count: 'active' },
    ],
  },
  {
    key: 'account',
    title: 'Кабинет',
    items: [
      { href: '/settings', label: 'Настройки', icon: 'settings' },
      { href: '/support', label: 'Поддержка', icon: 'chat' },
    ],
  },
];

/**
 * Счётчики меню. Пока один — заявки в работе: это то, чего мерчант ждёт
 * и ради чего открывает кабинет. Остальные разделы счётчиком ничего не
 * сказали бы.
 */
export type NavCounts = {
  /** Заявки, которые ещё не закрыты: они и есть незаконченная работа. */
  readonly active: number;
};

/** Ключ в хранилище браузера. Личная настройка: чужих кабинетов не касается. */
export const NAV_COLLAPSED_KEY = 'tobee.cabinet.nav.collapsed';
