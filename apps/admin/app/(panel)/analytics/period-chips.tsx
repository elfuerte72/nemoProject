'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PERIOD_LABELS, type PeriodKey } from '@/lib/period';

/**
 * Чипы периода и свой отрезок датами.
 *
 * Выбор живёт в адресе: сводку считает сервер, а ссылку на «прошлые
 * тридцать дней» можно переслать и открыть кнопкой браузера.
 */
export function PeriodChips({
  current,
  from,
  to,
  basePath = '/analytics',
}: {
  current: PeriodKey;
  /** Раздел, в адрес которого уходит период. */
  basePath?: string;
  /** Границы своего периода днями «2026-09-02» — для полей. */
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const quick: PeriodKey[] = ['today', '7d', '30d', '90d'];

  return (
    <div className="period">
      <div className="chips">
        {quick.map((key) => (
          <Link
            key={key}
            href={`${basePath}?period=${key}`}
            className={current === key ? 'chip chip--on' : 'chip'}
            scroll={false}
          >
            {PERIOD_LABELS[key]}
          </Link>
        ))}
      </div>
      <form
        className="period__custom"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(`${basePath}?period=custom&from=${draftFrom}&to=${draftTo}`);
        }}
      >
        <label className="field field--narrow">
          <span className="label">С</span>
          <input
            className="input"
            type="date"
            value={draftFrom}
            onChange={(event) => setDraftFrom(event.target.value)}
          />
        </label>
        <label className="field field--narrow">
          <span className="label">По</span>
          <input
            className="input"
            type="date"
            value={draftTo}
            onChange={(event) => setDraftTo(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className={current === 'custom' ? 'btn btn--soft' : 'btn btn--ghost'}
          disabled={!draftFrom || !draftTo}
        >
          Показать
        </button>
      </form>
    </div>
  );
}
