'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  NAV_COLLAPSED_KEY,
  NAV_GROUPS,
  isCurrentSection,
  parseCollapsed,
  serializeCollapsed,
  toggleCollapsed,
  type NavCounts,
  type NavGroup,
  type NavItem,
} from '@/lib/nav';
import { Brand } from '@/app/ui/brand';
import { Icon } from '@/app/ui/icons';

/**
 * Постоянное меню панели.
 *
 * Клиентский компонент ради двух вещей: текущий раздел определяется по
 * адресу, а адрес меняется без перезагрузки; свёртка группы — личная и
 * живёт в браузере. Всё остальное — счётчики, состав разделов —
 * приходит готовым.
 */

export type SidebarCounts = NavCounts;

export function Sidebar({ counts }: { counts: SidebarCounts }) {
  const pathname = usePathname();
  /*
   * Свёрнутое читается после первого показа, а не при нём: сервер о
   * браузере не знает, и разметка, собранная с оглядкой на хранилище,
   * разошлась бы с серверной. Мгновение с развёрнутыми группами —
   * плата за это, и она меньше мигания всего меню.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    try {
      setCollapsed(parseCollapsed(window.localStorage.getItem(NAV_COLLAPSED_KEY)));
    } catch {
      // Хранилище закрыто — меню просто не запомнит свёртку.
    }
  }, []);

  const toggle = (key: string) => {
    const next = toggleCollapsed(collapsed, key);
    setCollapsed(next);
    try {
      window.localStorage.setItem(NAV_COLLAPSED_KEY, serializeCollapsed(next));
    } catch {
      // То же: без памяти, но работает.
    }
  };

  return (
    <aside className="sidebar">
      <Link href="/" className="sidebar__brand" aria-label="Tobee, панель — на рабочий стол">
        <Brand eyebrow="панель" />
      </Link>

      <nav className="sidebar__nav">
        {NAV_GROUPS.map((group) => (
          <Group
            key={group.key}
            group={group}
            counts={counts}
            pathname={pathname}
            open={!collapsed.has(group.key)}
            onToggle={() => toggle(group.key)}
          />
        ))}
      </nav>
    </aside>
  );
}

function Group({
  group,
  counts,
  pathname,
  open,
  onToggle,
}: {
  group: NavGroup;
  counts: NavCounts;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  const id = `nav-${group.key}`;
  /*
   * Группа с текущим разделом не сворачивается: свёрнутая, она прятала
   * бы подсветку того места, где человек находится.
   */
  const holdsCurrent = group.items.some((item) => isCurrentSection(item.href, pathname));
  const shown = open || holdsCurrent;

  return (
    <div className="sidebar__section">
      <button
        type="button"
        className="sidebar__group"
        aria-expanded={shown}
        aria-controls={id}
        onClick={onToggle}
      >
        {group.title}
        <span className="sidebar__group-chevron" aria-hidden>
          <Icon name="chevron" size={13} />
        </span>
      </button>
      {/* Скрытием, а не снятием: разметка посчитана, и возвращается она за кадр. */}
      <div id={id} className="sidebar__items" hidden={!shown}>
        {group.items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            count={item.count ? counts[item.count] : undefined}
            current={isCurrentSection(item.href, pathname)}
          />
        ))}
      </div>
    </div>
  );
}

function NavLink({
  item,
  count,
  current,
}: {
  item: NavItem;
  count: number | undefined;
  current: boolean;
}) {
  return (
    <Link
      href={item.href}
      className="sidebar__link"
      {...(current ? { 'aria-current': 'page' as const } : {})}
      // Голосом счётчик читается как число после названия раздела и
      // ничего не значит: вслух он должен называть, чего это число.
      {...(count ? { 'aria-label': `${item.label}, в очереди: ${count}` } : {})}
    >
      <span className="sidebar__icon">
        <Icon name={item.icon} />
      </span>
      {item.label}
      {count ? <span className="sidebar__count">{count}</span> : undefined}
    </Link>
  );
}
