'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/exchange-request-labels';
import type { DeskFilter, DeskScope, ExchangeRow } from '@/lib/exchange-rows';
import { formatAmount } from '@/lib/format';
import { pillClass } from '@/lib/labels';
import { cursorOf, cursorToParams, mergePages } from '@/lib/paging';
import { Moment } from '@/app/ui/moment';

/**
 * Список раздела стола с дочитыванием.
 *
 * Первая страница приходит с сервера и перечитывается тихим
 * обновлением; дочитанное живёт здесь и дописывается к ней без дублей.
 * Смена фильтра сбрасывает дочитанное — родитель меняет `key`, и
 * компонент собирается заново: хвост, дочитанный под другим фильтром,
 * к новому списку не относится.
 */
export function ExchangeTable({
  rows,
  total,
  scope,
  filter,
  empty,
  showManager = false,
}: {
  rows: readonly ExchangeRow[];
  /** Сколько строк всего: у выборки есть предел, и список бывает короче. */
  total: number;
  scope: DeskScope;
  filter: DeskFilter;
  empty: string;
  /** Колонка «ведёт» — только там, где заявки чужие. */
  showManager?: boolean;
}) {
  const [extra, setExtra] = useState<readonly ExchangeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const shown = mergePages(rows, extra);

  // Перечитанная первая страница могла впитать часть хвоста — он больше не лишний.
  useEffect(() => {
    setExtra((current) => current.filter((row) => !rows.some((one) => one.id === row.id)));
  }, [rows]);

  if (shown.length === 0) {
    return <p className="empty">{empty}</p>;
  }

  const more = async () => {
    const cursor = cursorOf(shown);
    if (!cursor) return;
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({
        scope,
        q: filter.q,
        kind: filter.kind,
        status: filter.status,
        ...cursorToParams(cursor),
      });
      const response = await fetch(`/api/exchange-requests?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { rows: ExchangeRow[] };
      setExtra((current) => mergePages(current, body.rows));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const columns = showManager ? 'table--exchange-taken' : 'table--exchange';
  const remaining = Math.max(total - shown.length, 0);

  return (
    <>
      <div aria-hidden className={`table__head ${columns}`}>
        <span>Обмен</span>
        <span>Вид</span>
        <span>Клиент</span>
        <span>Состояние</span>
        {showManager ? <span>Ведёт</span> : undefined}
        <span>Подана</span>
      </div>
      <ul className={`table ${columns}`}>
        {shown.map((request) => (
          <li
            key={request.id}
            className={
              STATUS_TONES[request.status] === 'wait'
                ? 'table__item table__item--fresh'
                : 'table__item table__item--settled'
            }
          >
            {/*
              Ссылка — вся строка, а не сумма в ней: попадать курсором в
              четыре слова текста тридцать раз подряд менеджеру незачем.
            */}
            <Link href={`/exchange-requests/${request.id}`} className="table__row">
              {/*
                Обе стороны сделки: сумма к выдаче посчитана при подаче
                по курсу заявки — это то самое число, которое увидел
                клиент. У наличной заявки его нет: курс называет
                менеджер.
              */}
              <span className="cell cell--num">
                <span className="cell__label">Обмен</span>
                <span className="cell__value">
                  {formatAmount(request.fromAmount)} {request.fromCode} →{' '}
                  {request.toAmount ? `${formatAmount(request.toAmount)} ` : ''}
                  {request.toCode}
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Вид</span>
                <span className="cell__note">{KIND_LABELS[request.kind]}</span>
              </span>
              {/*
                Ник сверху, номер под ним: в очереди из десятка строк
                номера отличаются друг от друга только цифрами в
                середине, а ник читается сразу.
              */}
              <span className="cell">
                <span className="cell__label">Клиент</span>
                <span className="cell__value">
                  {request.clientUsername ? `@${request.clientUsername}` : 'Без ника'}
                </span>
                <span className="cell__note">{request.clientId}</span>
              </span>
              <span className="cell">
                <span className="cell__label">Состояние</span>
                <span className={pillClass(STATUS_TONES[request.status])}>
                  {STATUS_LABELS[request.status]}
                </span>
              </span>
              {showManager ? (
                <span className="cell">
                  <span className="cell__label">Ведёт</span>
                  <span className="cell__note">{request.assignedManagerName ?? '—'}</span>
                </span>
              ) : undefined}
              <span className="cell cell--num">
                <span className="cell__label">Подана</span>
                <span className="cell__note">
                  <Moment at={request.createdAt} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {/*
        Об усечении сказано прямо: список, молча обрезанный на полсотне,
        читается как весь — и по нему делают выводы о работе. Дочитать
        можно отсюда же, не перечитывая показанное.
      */}
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
