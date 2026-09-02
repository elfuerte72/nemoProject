'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_LABELS, STATUS_TONES } from '@/lib/exchange-request-labels';
import { formatAmount } from '@/lib/format';
import { pillClass } from '@/lib/labels';
import { classifyQuery, directHref, type PaletteQuery } from '@/lib/palette';
import { Icon } from '@/app/ui/icons';
import type { SearchHit } from '@/app/api/search/route';

/**
 * Палитра быстрого перехода: ⌘K, два символа, Enter.
 *
 * Открывается с поля в шапке и с клавиатуры. Полный номер заявки или
 * ID клиента ведут сразу, остальное ищется в открытых заявках, пока
 * набирают, — с паузой в треть секунды, чтобы не спрашивать сервер на
 * каждую букву.
 *
 * Порталом в `body`: шапка липкая, и слой, открытый внутри неё, жил бы
 * в её системе отсчёта. Фокус после закрытия возвращается в поле
 * шапки, откуда палитру и открыли.
 */
export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const query: PaletteQuery = classifyQuery(typed);

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setHits([]);
    setSelected(0);
    // Фокус после того, как слой оказался в дереве.
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || query.kind !== 'search') {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.query)}`, {
          signal: controller.signal,
        });
        if (response.ok) {
          const body = (await response.json()) as { hits: SearchHit[] };
          setHits(body.hits);
          setSelected(0);
        }
      } catch {
        // Отменённый запрос или сеть: список просто не обновится.
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Ключ — сама строка поиска, а не объект разбора: он новый на каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query.kind === 'search' ? query.query : '']);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  if (!open) return null;

  const direct = directHref(query);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((one) => Math.min(one + 1, Math.max(hits.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((one) => Math.max(one - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (direct) {
        go(direct);
      } else if (hits[selected]) {
        go(`/exchange-requests/${hits[selected].id}`);
      }
    }
  };

  return createPortal(
    <div className="palette" role="presentation" onMouseDown={onClose}>
      <div
        className="palette__box"
        role="dialog"
        aria-modal
        aria-label="Быстрый переход"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette__field">
          <Icon name="search" size={16} />
          <input
            ref={input}
            className="palette__input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Номер заявки, ник или ID клиента"
            aria-label="Номер заявки, ник или ID клиента"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="topbar__kbd" aria-hidden>
            esc
          </kbd>
        </div>

        <div className="palette__body">
          {direct ? (
            <button
              type="button"
              className="palette__item palette__item--on"
              onClick={() => go(direct)}
            >
              <span className="palette__main">
                {query.kind === 'request' ? 'Открыть заявку' : 'Открыть переписку с клиентом'}
              </span>
              <span className="palette__note mono">
                {query.kind === 'request' ? query.id : query.kind === 'client' ? query.id : ''}
              </span>
            </button>
          ) : query.kind === 'search' ? (
            hits.length ? (
              <ul className="palette__list" role="listbox">
                {hits.map((hit, index) => (
                  <li key={hit.id} role="option" aria-selected={index === selected}>
                    <button
                      type="button"
                      className={
                        index === selected ? 'palette__item palette__item--on' : 'palette__item'
                      }
                      onMouseEnter={() => setSelected(index)}
                      onClick={() => go(`/exchange-requests/${hit.id}`)}
                    >
                      <span className="palette__main">
                        {formatAmount(hit.fromAmount)} {hit.fromCode} →{' '}
                        {hit.toAmount ? `${formatAmount(hit.toAmount)} ` : ''}
                        {hit.toCode}
                      </span>
                      <span className="palette__note">
                        {hit.clientUsername ? `@${hit.clientUsername}` : hit.clientId}
                        {hit.assignedManagerName ? ` · ведёт ${hit.assignedManagerName}` : ''}
                      </span>
                      <span className={pillClass(STATUS_TONES[hit.status])}>
                        {STATUS_LABELS[hit.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="palette__hint">
                {busy
                  ? 'Ищу…'
                  : 'Среди открытых заявок ничего нет. Исполненные и отменённые здесь пока не ищутся.'}
              </p>
            )
          ) : (
            <p className="palette__hint">
              Введите хотя бы два символа. Полный номер заявки или ID клиента открывают их сразу.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Хук горячей клавиши: ⌘K на Mac, Ctrl+K на остальных. Слушает документ,
 * чтобы палитра открывалась и из поля формы, и из таблицы.
 */
export function usePaletteHotkey(onOpen: () => void): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpen();
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [onOpen]);
}
