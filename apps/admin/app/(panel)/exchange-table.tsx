'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/exchange-request-labels';
import type { DeskFilter, DeskScope, ExchangeRow } from '@/lib/exchange-rows';
import { formatAmount } from '@/lib/format';
import { pillClass } from '@/lib/labels';
import { cursorOf, cursorToParams, mergePages } from '@/lib/paging';
import { gridColumns, type TablePrefs } from '@/lib/table-prefs';
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
  prefs,
  showManager = false,
}: {
  rows: readonly ExchangeRow[];
  /** Сколько строк всего: у выборки есть предел, и список бывает короче. */
  total: number;
  scope: DeskScope;
  filter: DeskFilter;
  empty: string;
  /** Личные настройки: колонки, плотность, строк на странице. */
  prefs: TablePrefs;
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
        limit: String(prefs.pageSize),
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

  const show = (column: 'kind' | 'client' | 'manager' | 'submitted') =>
    !prefs.hidden.includes(column);
  const manager = showManager && show('manager');
  /*
   * Сетка задаётся здесь, а не классом очереди: набор колонок теперь
   * личный, и шапка со строками берут его из одной переменной.
   */
  const columns = prefs.dense ? 'table table--dense' : 'table';
  const style = { '--cols': gridColumns(prefs, showManager) } as React.CSSProperties;
  const remaining = Math.max(total - shown.length, 0);

  return (
    <>
      <div aria-hidden className="table__head" style={style}>
        <span>Обмен</span>
        {show('kind') ? <span>Вид</span> : undefined}
        {show('client') ? <span>Клиент</span> : undefined}
        <span>Состояние</span>
        {manager ? <span>Ведёт</span> : undefined}
        {show('submitted') ? <span>Подана</span> : undefined}
      </div>
      <ul className={columns} style={style}>
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
              {show('kind') ? (
                <span className="cell">
                  <span className="cell__label">Вид</span>
                  <span className="cell__note">{KIND_LABELS[request.kind]}</span>
                </span>
              ) : undefined}
              {/*
                Ник сверху, номер под ним: в очереди из десятка строк
                номера отличаются друг от друга только цифрами в
                середине, а ник читается сразу.
              */}
              {show('client') ? (
                <span className="cell">
                  <span className="cell__label">Клиент</span>
                  <span className="cell__value">
                    {request.clientUsername ? `@${request.clientUsername}` : 'Без ника'}
                  </span>
                  <span className="cell__note">{request.clientId}</span>
                </span>
              ) : undefined}
              <span className="cell">
                <span className="cell__label">Состояние</span>
                <span className={pillClass(STATUS_TONES[request.status])}>
                  {STATUS_LABELS[request.status]}
                </span>
              </span>
              {manager ? (
                <span className="cell">
                  <span className="cell__label">Ведёт</span>
                  <span className="cell__note">{request.assignedManagerName ?? '—'}</span>
                </span>
              ) : undefined}
              {show('submitted') ? (
                <span className="cell cell--num">
                  <span className="cell__label">Подана</span>
                  <span className="cell__note">
                    <Moment at={request.createdAt} />
                  </span>
                </span>
              ) : undefined}
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
              {loading ? 'Дочитываю…' : `Показать ещё ${Math.min(remaining, prefs.pageSize)}`}
            </button>
          </div>
        </div>
      ) : undefined}
    </>
  );
}
