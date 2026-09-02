/**
 * Карта разделов панели и память о свёрнутых группах меню.
 *
 * Список пунктов лежит здесь, а не в разметке меню: раздел заводится
 * одной строкой массива, и та же карта пригодится палитре быстрого
 * перехода — двух списков разделов у панели быть не должно.
 *
 * Разделы администратора видны всем. Скрывать их значило бы полагаться
 * на то, что менеджер не наберёт адрес руками, — это не разграничение
 * доступа, а его видимость; отказывают сами операции.
 */

export type NavIcon =
  | 'exchange'
  | 'withdrawal'
  | 'card'
  | 'chat'
  | 'settings'
  | 'log'
  | 'account'
  | 'chart'
  | 'user';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: NavIcon;
  /** Какой счётчик из меню показывать рядом с названием. */
  readonly count?: keyof NavCounts | undefined;
}

export interface NavGroup {
  /** Ключ группы: по нему запоминается свёртка. Не меняется при переименовании. */
  readonly key: string;
  readonly title: string;
  readonly items: readonly NavItem[];
}

export interface NavCounts {
  readonly exchange: number;
  readonly withdrawals: number;
  readonly cards: number;
  /** Клиенты, ждущие ответа: столько же работы, сколько в очередях. */
  readonly conversations: number;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'work',
    title: 'Основное',
    items: [
      { href: '/', label: 'Обмен', icon: 'exchange', count: 'exchange' },
      { href: '/withdrawals', label: 'Вывод', icon: 'withdrawal', count: 'withdrawals' },
      { href: '/card-applications', label: 'Карты', icon: 'card', count: 'cards' },
      { href: '/conversations', label: 'Обращения', icon: 'chat', count: 'conversations' },
      { href: '/clients', label: 'Клиенты', icon: 'user' },
    ],
  },
  {
    key: 'admin',
    title: 'Администратор',
    items: [
      { href: '/analytics', label: 'Аналитика', icon: 'chart' },
      { href: '/service-accounts', label: 'Счета сервиса', icon: 'account' },
      { href: '/settings', label: 'Настройки', icon: 'settings' },
      { href: '/requisite-access', label: 'Журнал доступа', icon: 'log' },
    ],
  },
];

/**
 * Текущий раздел — по адресу. Корень отмечается только на самом корне:
 * иначе он подсвечен всегда, потому что с него начинается любой адрес.
 * Остальные разделы — с вложенными страницами: карточка заявки
 * принадлежит своему разделу.
 */
export function isCurrentSection(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** Ключ в хранилище браузера. Личная настройка: коллег не касается. */
export const NAV_COLLAPSED_KEY = 'nemo.admin.nav.collapsed';

/**
 * Свёрнутые группы из строки хранилища. Всё, что не список строк, —
 * пустой набор: испорченная запись не должна ронять меню, а незнакомые
 * ключи безвредны — группы с таким ключом просто нет.
 */
export function parseCollapsed(raw: string | null | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((one): one is string => typeof one === 'string'));
  } catch {
    return new Set();
  }
}

export function serializeCollapsed(collapsed: ReadonlySet<string>): string {
  return JSON.stringify([...collapsed]);
}

export function toggleCollapsed(collapsed: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(collapsed);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
