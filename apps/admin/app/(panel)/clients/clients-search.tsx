'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Поиск по нику или ID: живёт в адресе, уходит с паузой в треть секунды.
 * Тот же приём, что у фильтров стола.
 */
export function ClientsSearch({ query }: { query: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [typed, setTyped] = useState(query);
  const pushed = useRef(query);

  useEffect(() => {
    if (query !== pushed.current) {
      pushed.current = query;
      setTyped(query);
    }
  }, [query]);

  useEffect(() => {
    if (typed === query) return;
    const timer = setTimeout(() => {
      pushed.current = typed;
      const next = new URLSearchParams(window.location.search);
      if (typed) next.set('q', typed);
      else next.delete('q');
      const search = next.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed, query, pathname, router]);

  return (
    <label className="filters__field">
      <span className="cell__label">Поиск по клиенту</span>
      <input
        className="input"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder="Ник или ID клиента"
        type="search"
        inputMode="search"
        autoComplete="off"
      />
    </label>
  );
}
