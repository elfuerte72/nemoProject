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
  /*
   * Касса стоит своей группой, а не в «Работе»: за ней нет денег
   * сервиса — покупатель платит мерчанту мимо нас, — и соседство со
   * заявками, по которым деньги идут, читалось бы как одно и то же.
   * Что именно тут нарисовано, а что работает, сказано на каждом из
   * трёх экранов.
   *
   * Экран назван так, как назвал его владелец на звонке 8 сентября
   * 2026, — «POS-терминал»: этим словом он показывал раздел у образца,
   * и переименование в «Кассу» заставило бы его искать в своём же
   * кабинете то, что он просил. Касса осталась названием места —
   * группы и полноэкранного режима, — как и у образца («POS Касса»).
   */
  {
    key: 'till',
    title: 'Касса',
    items: [
      { href: '/pos', label: 'POS-терминал', icon: 'spark' },
      { href: '/invoices', label: 'Счета', icon: 'card' },
      { href: '/refunds', label: 'Возвраты', icon: 'withdrawal' },
    ],
  },
  {
    key: 'integration',
    title: 'Интеграция',
    items: [
      { href: '/keys', label: 'API', icon: 'key' },
      { href: '/webhooks', label: 'Вебхуки', icon: 'plug' },
      { href: '/webhooks/guide', label: 'Как встроить', icon: 'question' },
      { href: '/calls', label: 'Журнал вызовов', icon: 'log' },
      { href: '/docs', label: 'Документация', icon: 'book' },
      { href: '/sandbox', label: 'Песочница', icon: 'spark' },
    ],
  },
  {
    key: 'account',
    title: 'Кабинет',
    items: [
      /*
       * Сотрудники стоят здесь, а не в «Работе»: это про сам кабинет —
       * кто в него входит, — а не про заявки. Видит пункт один
       * владелец, и решает это `navGroupsFor` по той же таблице прав,
       * что и операции ядра (тикет 17).
       */
      { href: '/staff', label: 'Сотрудники', icon: 'user' },
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

/**
 * Разделы кабинета амбассадора.
 *
 * Порядок отвечает на вопросы по мере их появления: сколько заработал,
 * кто эти люди, чем они пользуются, где взять ссылку и как получить
 * деньги. Меню то же, что у мерчанта, — общая деталь `@nemo/ui`, — а
 * состав свой: общих разделов у них нет вовсе.
 */
export const AMBASSADOR_NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'work',
    title: 'Программа',
    items: [
      { href: '/ambassador', label: 'Обзор', icon: 'home' },
      { href: '/ambassador/people', label: 'Мои люди', icon: 'user' },
      { href: '/ambassador/services', label: 'Услуги', icon: 'exchange' },
      { href: '/ambassador/link', label: 'Ссылка', icon: 'spark' },
      { href: '/ambassador/withdrawal', label: 'Вывод', icon: 'withdrawal' },
    ],
  },
];

/** Своя кука свёртки: меню у амбассадора другое, и чужая настройка ему не подходит. */
export const AMBASSADOR_NAV_COLLAPSED_KEY = 'tobee.ambassador.nav.collapsed';
