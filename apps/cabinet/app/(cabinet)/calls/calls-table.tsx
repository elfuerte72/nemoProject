'use client';

import { useEffect, useState } from 'react';
import { EmptyState, Moment } from '@nemo/ui';
import { CALLS_PAGE, isOk, type CallOutcome, type CallRow } from '@/lib/call-rows';

/**
 * Таблица вызовов с дочитыванием по курсору «время и номер» — тем же
 * правилом, что список заявок: первая страница с сервером, хвост
 * дописывается сюда без дублей.
 */
export function CallsTable({
  rows,
  total,
  outcome,
  keyId,
}: {
  readonly rows: readonly CallRow[];
  readonly total: number;
  readonly outcome: CallOutcome;
  readonly keyId: string | undefined;
}) {
  const [extra, setExtra] = useState<readonly CallRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const seen = new Set(rows.map((row) => row.id));
  const shown = [...rows, ...extra.filter((row) => !seen.has(row.id))];

  useEffect(() => {
    setExtra((current) => current.filter((row) => !rows.some((one) => one.id === row.id)));
  }, [rows]);

  useEffect(() => {
    setExtra([]);
  }, [outcome, keyId]);

  if (shown.length === 0) {
    return (
      <EmptyState
        icon="log"
        title="Вызовов пока нет"
        text={
          outcome === 'all'
            ? 'Первый же запрос с вашим ключом встанет сюда — и удачный, и отвергнутый.'
            : 'Таких вызовов за тридцать дней не было.'
        }
      />
    );
  }

  const remaining = Math.max(total - shown.length, 0);

  const more = async () => {
    const last = shown[shown.length - 1];
    if (!last) return;

    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({ outcome, after: last.at, afterId: last.id });
      if (keyId) params.set('key', keyId);
      const response = await fetch(`/api/calls?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { rows: CallRow[] };
      setExtra((current) => {
        const known = new Set([...rows, ...current].map((row) => row.id));
        return [...current, ...body.rows.filter((row) => !known.has(row.id))];
      });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ul className="table table--calls">
        <li className="table__head" aria-hidden>
          <span>Когда</span>
          <span>Метод</span>
          <span>Путь</span>
          <span>Код</span>
          <span>Время</span>
          <span>Ключ</span>
          <span>Что ответили</span>
        </li>
        {shown.map((call) => (
          <li key={call.id} className="table__item">
            <div className="table__row">
              <span className="cell">
                <span className="cell__label">Когда</span>
                <span className="cell__value">
                  <Moment at={call.at} />
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Метод</span>
                <span className="cell__value mono">{call.method}</span>
              </span>
              <span className="cell">
                <span className="cell__label">Путь</span>
                <span className="cell__value mono call__path">{call.path}</span>
              </span>
              <span className="cell">
                <span className="cell__label">Код</span>
                <span className={isOk(call.status) ? 'pill pill--done' : 'pill pill--wait'}>
                  {call.status}
                </span>
              </span>
              <span className="cell cell--num">
                <span className="cell__label">Время</span>
                <span className="cell__value">{call.durationMs} мс</span>
              </span>
              <span className="cell">
                <span className="cell__label">Ключ</span>
                <span className="cell__value">
                  {call.keyLabel} <span className="muted mono">{call.keyHint}</span>
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Что ответили</span>
                <span className="cell__value call__error">
                  {call.error ?? <span className="muted">—</span>}
                </span>
              </span>
            </div>
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
              {loading ? 'Дочитываю…' : `Показать ещё ${Math.min(remaining, CALLS_PAGE)}`}
            </button>
          </div>
        </div>
      ) : undefined}
    </>
  );
}
