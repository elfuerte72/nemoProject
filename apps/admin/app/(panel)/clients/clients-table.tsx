'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ClientTab } from '@nemo/core';
import type { ClientRowDto } from '@/lib/client-rows';
import { formatByCurrency } from '@/lib/money-list';
import { mergePages } from '@/lib/paging';
import { Moment } from '@/app/ui/moment';

/**
 * Список клиентов с дочитыванием по курсору — тем же правилом, что у
 * стола: первая страница с сервера, хвост здесь, без дублей.
 */
export function ClientsTable({
  rows,
  total,
  query,
  tab,
}: {
  rows: readonly ClientRowDto[];
  total: number;
  query: string;
  tab: ClientTab;
}) {
  const [extra, setExtra] = useState<readonly ClientRowDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const shown = mergePages(rows, extra);

  useEffect(() => {
    setExtra((current) => current.filter((row) => !rows.some((one) => one.id === row.id)));
  }, [rows]);

  if (shown.length === 0) {
    return (
      <p className="empty">
        {query || tab !== 'all'
          ? 'Никого не нашлось. Снимите фильтр или наберите иначе.'
          : 'Клиентов пока нет. Они появляются сами — при первом открытии приложения.'}
      </p>
    );
  }

  const more = async () => {
    const last = shown[shown.length - 1]!;
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({
        q: query,
        tab,
        after: last.cursor,
        afterId: last.id,
      });
      const response = await fetch(`/api/clients?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { rows: ClientRowDto[] };
      setExtra((current) => mergePages(current, body.rows));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const remaining = Math.max(total - shown.length, 0);

  return (
    <>
      <div aria-hidden className="table__head table--clients">
        <span>Клиент</span>
        <span>В сервисе с</span>
        <span>Заявок</span>
        <span>Последняя</span>
        <span>Оборот</span>
      </div>
      <ul className="table table--clients">
        {shown.map((client) => (
          <li
            key={client.id}
            className={
              client.waiting ? 'table__item table__item--fresh' : 'table__item table__item--settled'
            }
          >
            <Link href={`/clients/${client.id}`} className="table__row">
              <span className="cell">
                <span className="cell__label">Клиент</span>
                <span className="cell__value">
                  {client.username ? `@${client.username}` : 'Без ника'}
                  {client.regular ? <span className="tag tag--gold"> постоянный</span> : undefined}
                </span>
                <span className="cell__note">
                  {client.id}
                  {client.waiting ? ' · ждёт ответа' : ''}
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">В сервисе с</span>
                <span className="cell__note">
                  <Moment at={client.createdAt} mode="day" />
                </span>
              </span>
              <span className="cell cell--num">
                <span className="cell__label">Заявок</span>
                <span className="cell__value">{client.completed} исполнено</span>
                <span className="cell__note">
                  {client.open ? `${client.open} в работе · ` : ''}
                  {client.cancelled} отменено
                </span>
              </span>
              <span className="cell cell--num">
                <span className="cell__label">Последняя</span>
                <span className="cell__note">
                  {client.lastRequestAt ? <Moment at={client.lastRequestAt} /> : '—'}
                </span>
              </span>
              <span className="cell cell--num">
                <span className="cell__label">Оборот</span>
                <span className="cell__value">{formatByCurrency(client.turnover)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {remaining > 0 || failed ? (
        <div className="table__foot">
          <span>
            Показаны {shown.length} из {total}
            {failed ? ' · дочитать не удалось, попробуйте ещё раз' : ''}
          </span>
          <div className="table__foot-actions">
            <button
              type="button"
              className="btn btn--ghost btn--tiny"
              onClick={() => void more()}
              aria-busy={loading}
            >
              {loading ? 'Дочитываю…' : `Показать ещё ${Math.min(remaining, 50)}`}
            </button>
          </div>
        </div>
      ) : undefined}
    </>
  );
}
