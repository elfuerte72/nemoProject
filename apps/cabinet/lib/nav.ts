import type { NavGroup } from '@nemo/ui/nav';

/**
 * Карта разделов кабинета мерчанта.
 *
 * Форма списка и правила меню — общие с панелью и живут в `@nemo/ui`;
 * здесь только состав. Раздел заводится одной строкой массива.
 *
 * Порядок отвечает на вопросы по мере их появления: что у меня
 * происходит, как подать, что с моими заявками, куда приходят деньги
 * и почём, чем это делать программно, кто я такой и куда писать, если
 * что-то не так. Раздел «API» живёт по адресу `/keys`: `/api` занят
 * самими маршрутами.
 */

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'work',
    title: 'Работа',
    items: [
      { href: '/dashboard', label: 'Обзор', icon: 'home' },
      { href: '/requests/new', label: 'Новая заявка', icon: 'plus' },
      { href: '/requests', label: 'Заявки', icon: 'exchange', count: 'active' },
      { href: '/recipients', label: 'Получатели', icon: 'card' },
      { href: '/rates', label: 'Курсы', icon: 'chart' },
    ],
  },
  {
    key: 'integration',
    title: 'Интеграция',
    items: [
      { href: '/keys', label: 'API', icon: 'key' },
      { href: '/webhooks', label: 'Вебхуки', icon: 'plug' },
      { href: '/calls', label: 'Журнал вызовов', icon: 'log' },
      { href: '/docs', label: 'Документация', icon: 'book' },
      { href: '/sandbox', label: 'Песочница', icon: 'spark' },
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
