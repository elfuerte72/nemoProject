import Link from 'next/link';

/**
 * Табы состояния со счётчиками.
 *
 * Ссылки, а не кнопки: выбор живёт в адресе, и сужать выборку должен
 * сервер — иначе «таб» означал бы, что приехало всё, а часть спрятана
 * разметкой. Счётчик рядом с названием — сколько строк за табом, не
 * открывая его.
 */

export interface TabItem {
  readonly href: string;
  readonly label: string;
  readonly count?: number | undefined;
  readonly current: boolean;
}

export function Tabs({ items, label }: { items: readonly TabItem[]; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={item.current ? 'tab tab--on' : 'tab'}
          {...(item.current ? { 'aria-current': 'page' as const } : {})}
          scroll={false}
        >
          {item.label}
          {item.count !== undefined ? <span className="tab__count">{item.count}</span> : undefined}
        </Link>
      ))}
    </nav>
  );
}
