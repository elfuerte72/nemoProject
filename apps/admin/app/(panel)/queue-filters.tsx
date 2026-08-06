'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { inProgressExchangeStatuses, exchangeKinds } from '@nemo/types';
import { KIND_LABELS, STATUS_LABELS } from '@/lib/exchange-request-labels';

/**
 * Чем менеджер сужает очередь.
 *
 * Фильтры живут в адресе, а не в состоянии экрана: страница рисуется на
 * сервере, и выборку сужать должен он — иначе «фильтр» означал бы, что
 * с сервера всё равно приехало всё, а часть спрятана разметкой. Заодно
 * такой экран можно оставить открытым, переслать ссылкой и вернуться к
 * нему кнопкой браузера.
 *
 * Включённый фильтр назван прямо и снимается одним нажатием: человек,
 * забывший про фильтр, читает подмножество как всю очередь и делает из
 * этого выводы о работе.
 */

/**
 * Состояния, по которым сужают список в работе. Тот же набор, по
 * которому выбирает сама выборка: новое состояние появится в фильтре
 * само, а не тогда, когда о нём вспомнят.
 */
const WORKING_STATUSES = inProgressExchangeStatuses;

export function QueueFilters({
  query,
  kind,
  status,
  onTyping,
}: {
  readonly query: string;
  readonly kind: string;
  readonly status: string;
  /** Пока в поле набирают, тихое обновление ждёт. */
  readonly onTyping?: (typing: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [typed, setTyped] = useState(query);
  /*
   * Что мы сами положили в адрес. Без этого возврат кнопкой браузера
   * ломался бы: адрес уехал бы назад, набранное осталось бы прежним, и
   * следующий же тик вернул бы адрес вперёд.
   */
  const pushed = useRef(query);

  useEffect(() => {
    if (query !== pushed.current) {
      pushed.current = query;
      setTyped(query);
    }
  }, [query]);

  /*
   * Признак набора выводится из самого набранного, а не ставится
   * вручную: поставленный вручную он однажды остаётся поднятым — и
   * тихое обновление выключается до перезагрузки страницы.
   */
  useEffect(() => {
    onTyping?.(typed !== query);
    return () => onTyping?.(false);
  }, [typed, query, onTyping]);

  /*
   * Набранное уходит в адрес не сразу: запрос на каждую букву — это
   * десяток выборок, из которых нужна последняя. Треть секунды —
   * пауза, которой человек не замечает, а сеть замечает.
   */
  useEffect(() => {
    if (typed === query) return;
    const timer = setTimeout(() => {
      pushed.current = typed;
      router.replace(withParam(pathname, 'q', typed), { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed, query, pathname, router]);

  const narrowed = Boolean(query || kind || status);

  return (
    <div className="filters">
      <label className="filters__field">
        <span className="cell__label">Поиск по клиенту</span>
        <input
          className="input"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Ник или номер клиента целиком"
          type="search"
          inputMode="search"
          autoComplete="off"
        />
      </label>

      <select
        className="input filters__pick"
        value={kind}
        aria-label="Вид обмена"
        onChange={(event) =>
          router.replace(withParam(pathname, 'kind', event.target.value), { scroll: false })
        }
      >
        <option value="">Любой вид</option>
        {exchangeKinds.map((one) => (
          <option key={one} value={one}>
            {KIND_LABELS[one]}
          </option>
        ))}
      </select>

      <select
        className="input filters__pick"
        value={status}
        aria-label="Состояние заявки в работе"
        onChange={(event) =>
          router.replace(withParam(pathname, 'status', event.target.value), { scroll: false })
        }
      >
        <option value="">Любое состояние</option>
        {WORKING_STATUSES.map((one) => (
          <option key={one} value={one}>
            {STATUS_LABELS[one]}
          </option>
        ))}
      </select>

      {narrowed ? (
        <button
          type="button"
          className="btn btn--soft btn--tiny"
          onClick={() => {
            setTyped('');
            pushed.current = '';
            router.replace(pathname, { scroll: false });
          }}
        >
          Показано подмножество — снять фильтр
        </button>
      ) : undefined}
    </div>
  );
}

/**
 * Тот же адрес с одним изменённым параметром. Пустое значение параметр
 * убирает: `?kind=` в ссылке выглядит как фильтр, которого нет.
 *
 * Остальные параметры берутся из живого адреса, а не из снимка,
 * пришедшего в отрисовку: два фильтра, переключённые быстрее, чем
 * страница успевает перерисоваться, второй сбросил бы первый — и
 * заметить это можно, только сверив адрес.
 */
function withParam(pathname: string, name: string, value: string): string {
  const next = new URLSearchParams(window.location.search);
  if (value) {
    next.set(name, value);
  } else {
    next.delete(name);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}
