'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EmptyState, Moment } from '@nemo/ui';
import { formatMoney } from '@nemo/ui/format';
import { cursorOf, cursorToParams, mergePages } from '@nemo/ui/paging';
import { STATUS_LABELS, STATUS_TONES } from '@/lib/labels';
import type { RequestRow, RequestTab } from '@/lib/request-rows';

/**
 * Список заявок с дочитыванием по курсору — тем же правилом, что у
 * очереди в панели: первая страница приходит с сервером, хвост
 * дописывается сюда и склеивается без дублей.
 */
export function RequestsTable({
  rows,
  total,
  tab,
  search,
}: {
  readonly rows: readonly RequestRow[];
  readonly total: number;
  readonly tab: RequestTab;
  /**
   * Что ищут. Едет в запрос дочитывания: без него вторая страница
   * приехала бы по всему кабинету, и под найденным появились бы строки,
   * которых не искали.
   */
  readonly search: string;
}) {
  const [extra, setExtra] = useState<readonly RequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const shown = mergePages(rows, extra);

  /*
   * Тихое обновление перечитывает первую страницу, и строка, уехавшая
   * из неё вниз, пришла бы дважды: из хвоста она убирается. Целиком
   * хвост при этом не сбрасывается — иначе дочитанное исчезало бы
   * каждые полминуты само.
   */
  useEffect(() => {
    setExtra((current) => current.filter((row) => !rows.some((one) => one.id === row.id)));
  }, [rows]);

  /*
   * Какая выборка на экране сейчас. Дочитывание сверяется с ней, когда
   * ответ пришёл: сменили таб или запрос, пока он шёл, — ответ прежней
   * выборки к новой не дописывается. С поиском это стало вероятнее:
   * запрос меняется с каждой набранной буквой.
   */
  const shownKey = `${tab}\n${search}`;
  const liveKey = useRef(shownKey);
  liveKey.current = shownKey;

  /* Сменился таб или запрос — хвост от прежней выборки чужой ей целиком. */
  useEffect(() => {
    setExtra([]);
  }, [tab, search]);

  if (shown.length === 0) {
    return (
      <EmptyState
        icon="exchange"
        title={search ? 'Ничего не нашлось' : 'Пока пусто'}
        text={
          search
            ? tab === 'all'
              ? 'Заявки с таким номером нет. Проверьте номер: он тот, который ваша система передала при подаче.'
              : 'В этом состоянии такой заявки нет. Посмотрите во «Всех»: ищущий номер обычно не знает, исполнена она или отменена.'
            : tab === 'open'
              ? 'Незакрытых заявок нет. Поданные вашей интеграцией встанут сюда.'
              : 'В этом состоянии заявок нет.'
        }
      />
    );
  }

  const remaining = Math.max(total - shown.length, 0);

  const more = async () => {
    const cursor = cursorOf(shown);
    if (!cursor) return;

    const askedFor = shownKey;
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({
        tab,
        ...(search ? { q: search } : {}),
        ...cursorToParams(cursor),
      });
      const response = await fetch(`/api/requests?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { rows: RequestRow[] };
      if (liveKey.current !== askedFor) return;
      setExtra((current) => mergePages(current, body.rows));
    } catch {
      // Дочитать не удалось — показанное остаётся на месте, а о неудаче
      // говорится строкой в подвале: молча погасшая кнопка читается как
      // «больше ничего нет».
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ul className="table table--requests">
        <li className="table__head" aria-hidden>
          <span>Отдаю</span>
          <span>Получаю</span>
          <span>Свой номер</span>
          <span>Состояние</span>
          <span>Подана</span>
        </li>
        {shown.map((request) => (
          <li key={request.id} className="table__item table__item--clickable">
            <Link className="table__row" href={`/requests/${request.id}`}>
              <span className="cell">
                <span className="cell__label">Отдаю</span>
                <span className="cell__value">
                  {formatMoney(request.fromAmount, request.fromCode)}
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Получаю</span>
                <span className="cell__value">
                  {request.toAmount
                    ? formatMoney(request.toAmount, request.toCode)
                    : `по курсу, ${request.toCode}`}
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Свой номер</span>
                <span className="cell__value">{request.reference ?? '—'}</span>
              </span>
              <span className="cell">
                <span className="cell__label">Состояние</span>
                <span className={`pill pill--${STATUS_TONES[request.status]}`}>
                  {STATUS_LABELS[request.status]}
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Подана</span>
                <span className="cell__value">
                  <Moment at={request.createdAt} />
                </span>
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
              {loading ? 'Дочитываю…' : `Показать ещё ${Math.min(remaining, 25)}`}
            </button>
          </div>
        </div>
      ) : undefined}
    </>
  );
}
