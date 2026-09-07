'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './icons.js';
import {
  currentSection,
  parseCollapsed,
  serializeCollapsed,
  toggleCollapsed,
  type NavCountMap,
  type NavGroup,
  type NavItem,
} from './nav.js';

/**
 * Постоянное меню рабочего интерфейса.
 *
 * Клиентский компонент ради двух вещей: текущий раздел определяется по
 * адресу, а адрес меняется без перезагрузки; свёртка группы — личная и
 * живёт в браузере. Всё остальное — счётчики, состав разделов —
 * приходит готовым.
 *
 * Состав разделов приходит снаружи: у панели менеджера он свой, у
 * кабинета мерчанта свой, а меню у них одно и то же.
 */

export function Sidebar({
  groups,
  counts,
  storageKey,
  brand,
  homeHref = '/',
  homeLabel,
}: {
  readonly groups: readonly NavGroup[];
  readonly counts: NavCountMap;
  /** Ключ в хранилище браузера: у каждого приложения свой. */
  readonly storageKey: string;
  /** Знак и имя: их рисует приложение — надпись под знаком у них разная. */
  readonly brand: ReactNode;
  readonly homeHref?: string;
  readonly homeLabel: string;
}) {
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
      setCollapsed(parseCollapsed(window.localStorage.getItem(storageKey)));
    } catch {
      // Хранилище закрыто — меню просто не запомнит свёртку.
    }
  }, [storageKey]);

  const toggle = (key: string) => {
    const next = toggleCollapsed(collapsed, key);
    setCollapsed(next);
    try {
      window.localStorage.setItem(storageKey, serializeCollapsed(next));
    } catch {
      // То же: без памяти, но работает.
    }
  };

  /*
   * Текущий пункт — один на всё меню, а не по группе: пункты бывают
   * вложены по адресу, и решать, чей адрес точнее, надо среди всех.
   */
  const current = currentSection(
    groups.flatMap((group) => group.items),
    pathname,
  );

  return (
    <aside className="sidebar">
      <Link href={homeHref} className="sidebar__brand" aria-label={homeLabel}>
        {brand}
      </Link>

      <nav className="sidebar__nav">
        {groups.map((group) => (
          <Group
            key={group.key}
            group={group}
            counts={counts}
            current={current}
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
  current,
  open,
  onToggle,
}: {
  group: NavGroup;
  counts: NavCountMap;
  /** Адрес текущего пункта меню, если он в меню есть. */
  current: string | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const id = `nav-${group.key}`;
  /*
   * Группа с текущим разделом не сворачивается: свёрнутая, она прятала
   * бы подсветку того места, где человек находится.
   */
  const holdsCurrent = group.items.some((item) => item.href === current);
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
            current={item.href === current}
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
