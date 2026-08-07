'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { StaffRole } from '@nemo/types';
import { ROLE_LABELS } from '@/lib/labels';

/**
 * Постоянное меню панели.
 *
 * Клиентский компонент ради одного: текущий раздел определяется по
 * адресу, а адрес меняется без перезагрузки. Всё остальное — счётчики,
 * имя, роль — приходит с сервера готовым.
 *
 * Разделы администратора видны всем. Скрывать их значило бы полагаться
 * на то, что менеджер не наберёт адрес руками, — это не разграничение
 * доступа, а его видимость; отказывают сами операции.
 */

export interface SidebarCounts {
  readonly exchange: number;
  readonly withdrawals: number;
  readonly cards: number;
  /** Клиенты, ждущие ответа: столько же работы, сколько в очередях. */
  readonly conversations: number;
}

interface Item {
  readonly href: string;
  readonly label: string;
  readonly icon:
    | 'exchange'
    | 'withdrawal'
    | 'card'
    | 'chat'
    | 'settings'
    | 'log'
    | 'account';
  readonly count?: number | undefined;
}

export function Sidebar({
  displayName,
  role,
  counts,
}: {
  displayName: string;
  role: StaffRole;
  counts: SidebarCounts;
}) {
  const pathname = usePathname();

  const work: readonly Item[] = [
    { href: '/', label: 'Обмен', icon: 'exchange', count: counts.exchange },
    { href: '/withdrawals', label: 'Вывод', icon: 'withdrawal', count: counts.withdrawals },
    { href: '/card-applications', label: 'Карты', icon: 'card', count: counts.cards },
    {
      href: '/conversations',
      label: 'Обращения',
      icon: 'chat',
      count: counts.conversations,
    },
  ];
  const admin: readonly Item[] = [
    { href: '/service-accounts', label: 'Счета сервиса', icon: 'account' },
    { href: '/settings', label: 'Настройки', icon: 'settings' },
    { href: '/requisite-access', label: 'Журнал доступа', icon: 'log' },
  ];

  /*
   * Корень отмечается только на самом корне: иначе он подсвечен всегда,
   * потому что с него начинается любой адрес. Остальные разделы — с
   * вложенными страницами: карточка заявки принадлежит своему разделу.
   */
  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        nemo <span>панель</span>
      </div>

      <nav className="sidebar__nav">
        {work.map((item) => (
          <NavLink key={item.href} item={item} current={isCurrent(item.href)} />
        ))}

        <div className="sidebar__group">Администратор</div>
        {admin.map((item) => (
          <NavLink key={item.href} item={item} current={isCurrent(item.href)} />
        ))}
      </nav>

      <div className="sidebar__foot">
        <div className="sidebar__who">
          <span className="sidebar__name">{displayName}</span>
          <span className="sidebar__role">{ROLE_LABELS[role]}</span>
        </div>
        {/*
          Кнопка, а не ссылка: выход меняет состояние, и срабатывать он
          должен по нажатию — а не от предзагрузки соседней вкладки.
          Переход адресом, а не router: после снятия куки нужен свежий
          запрос, иначе разделы приедут из кэша уже закрытой сессии.
        */}
        <button type="button" className="btn btn--ghost btn--wide" onClick={signOut}>
          Выйти
        </button>
      </div>
    </aside>
  );
}

async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

function NavLink({ item, current }: { item: Item; current: boolean }) {
  return (
    <Link
      href={item.href}
      className="sidebar__link"
      {...(current ? { 'aria-current': 'page' as const } : {})}
      // Голосом счётчик читается как число после названия раздела и
      // ничего не значит: вслух он должен называть, чего это число.
      {...(item.count ? { 'aria-label': `${item.label}, в очереди: ${item.count}` } : {})}
    >
      <span className="sidebar__icon">
        <Icon name={item.icon} />
      </span>
      {item.label}
      {item.count ? <span className="sidebar__count">{item.count}</span> : undefined}
    </Link>
  );
}

/**
 * Значки рисуются здесь, а не тянутся пакетом: их пять, и каждый — две
 * строки разметки. Зависимость с сотней значков стоила бы дороже.
 */
function Icon({ name }: { name: Item['icon'] }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'exchange':
      return (
        <svg {...common}>
          <path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5" />
        </svg>
      );
    case 'withdrawal':
      return (
        <svg {...common}>
          <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
          <path d="M4 19h16" />
        </svg>
      );
    case 'card':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M3 10h18M7 15h3" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M8 10h8" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4" />
        </svg>
      );
    case 'account':
      return (
        <svg {...common}>
          <path d="M4 10 12 4l8 6" />
          <path d="M6 10v8m4-8v8m4-8v8m4-8v8" />
          <path d="M4 20h16" />
        </svg>
      );
    case 'log':
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M9 12h7M9 16h7M9 8h3" />
        </svg>
      );
  }
}
