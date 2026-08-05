'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ClientHistoryEntry, ClientHistoryView } from '@nemo/core';
import { ApiError, get } from '@/lib/client-api';
import { isOpen, KIND_LABELS, outcomeOf } from '@/lib/exchange-request-labels';
import { formatAmount, formatDay, formatMoney, shortId } from '@/lib/format';
import {
  BONUS_KIND_LABELS,
  CARD_STATUS_LABELS,
  WITHDRAWAL_METHOD_LABELS,
  WITHDRAWAL_STATUS_LABELS,
} from '@/lib/labels';
import { Loading } from './ui/loading';

/**
 * История клиента: всё, что с ним происходило, одной лентой.
 *
 * Четыре потока — обмены, баллы, выводы и карта — раньше лежали каждый
 * в своём разделе, и «что было с моими деньгами» приходилось собирать
 * по трём экранам. Здесь они идут вперемешку по времени, а чипы сверху
 * оставляют один поток, когда ищут конкретное.
 *
 * Выводы стоят под «Бонусами», а не отдельным чипом: для клиента это
 * движение тех же баллов, и делить их значило бы спрашивать, чем
 * начисление отличается от его выплаты.
 *
 * Строки плоские — кроме незакрытой заявки на обмен: она ведёт на
 * главную, туда, где по ней платят и отменяют. Действия над заявкой
 * остаются в одном месте, иначе «на главной я мог отменить, здесь не
 * могу» становится вопросом к поддержке.
 */

type Filter = 'all' | 'exchange' | 'bonus' | 'card';

const FILTERS: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'exchange', label: 'Обмены' },
  { id: 'bonus', label: 'Бонусы' },
  { id: 'card', label: 'Карта' },
];

function suits(entry: ClientHistoryEntry, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'exchange':
      return entry.stream === 'exchange';
    case 'bonus':
      return entry.stream === 'bonus' || entry.stream === 'withdrawal';
    case 'card':
      return entry.stream === 'card';
  }
}

/** Своё у каждой записи: чем она была и как её узнать в ленте. */
function keyOf(entry: ClientHistoryEntry): string {
  switch (entry.stream) {
    case 'exchange':
    case 'withdrawal':
      return `${entry.stream}:${entry.request.id}`;
    case 'bonus':
      return `bonus:${entry.transaction.id}`;
    case 'card':
      return `card:${entry.application.id}`;
  }
}

export function HistorySection({
  revisit,
  focus,
  onOpenExchange,
}: {
  readonly revisit: number;
  /**
   * С каким отбором открыть ленту. Приходит от того, кто привёл сюда с
   * вопросом об одном потоке, — из профиля по ссылке «за что начислено».
   */
  readonly focus?: { readonly filter: Filter; readonly nonce: number } | undefined;
  /** Куда уводит незакрытая заявка: на главную, к её карточке. */
  readonly onOpenExchange: () => void;
}) {
  const [history, setHistory] = useState<ClientHistoryView>();
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  // Отбор ставится приведшим сюда, а дальше клиент волен его менять:
  // чип — это его инструмент, а не режим, в котором раздел заперт.
  useEffect(() => {
    if (focus) setFilter(focus.filter);
  }, [focus]);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await get<{ history: ClientHistoryView }>('/api/history');
        setHistory(loaded.history);
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'Не удалось загрузить историю');
      } finally {
        setLoading(false);
      }
    })();
    // Раздел остаётся в ряду и заново не собирается: заявки ведёт
    // менеджер, а баллы приходят от сделок приглашённых — и то и другое
    // меняется без участия клиента. Признак занятости при этом не
    // поднимается: читается уже показанное, и подменять ленту на
    // «Загружаем…» значило бы моргать ею в ответ на возвращение.
  }, [revisit]);

  /**
   * Лента разложена по дням. Группы считаются здесь, а не в разметке:
   * при переключении чипа пересобирается только отбор, а не весь
   * список заново.
   */
  const days = useMemo(() => {
    const groups: { readonly day: string; readonly entries: ClientHistoryEntry[] }[] = [];
    for (const entry of history?.entries ?? []) {
      if (!suits(entry, filter)) continue;
      const day = formatDay(entry.at);
      const last = groups.at(-1);
      if (last?.day === day) last.entries.push(entry);
      else groups.push({ day, entries: [entry] });
    }
    return groups;
  }, [history, filter]);

  if (loading) {
    return <Loading />;
  }

  if (!history) {
    return <p className="error">{error ?? 'Не удалось загрузить историю'}</p>;
  }

  return (
    <>
      <div className="chips" role="group" aria-label="Что показывать">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            className="chip"
          >
            {label}
          </button>
        ))}
      </div>

      {days.length === 0 ? (
        <p className="empty">
          {filter === 'all'
            ? 'Здесь появится всё, что вы делали в сервисе: обмены, баллы и заявки.'
            : 'В этом разделе истории пока пусто.'}
        </p>
      ) : (
        days.map((group) => (
          <div key={group.day}>
            <div className="section-title">{group.day}</div>
            <ul className="rows">
              {group.entries.map((entry) => (
                <li key={keyOf(entry)} className="row">
                  <Entry entry={entry} onOpenExchange={onOpenExchange} />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {/*
        О неполноте лента говорит сама: молча показанный кусок читается
        как «это всё, что было». Признак приходит с сервера — приложению
        незачем помнить, на сколько записей стоит потолок.
      */}
      {history.truncated ? (
        <p className="hint">
          Показаны последние записи. За более ранними — к менеджеру: он видит их целиком.
        </p>
      ) : undefined}
    </>
  );
}

/** Одна запись ленты. Чем она была, решает её поток. */
function Entry({
  entry,
  onOpenExchange,
}: {
  readonly entry: ClientHistoryEntry;
  readonly onOpenExchange: () => void;
}) {
  switch (entry.stream) {
    case 'exchange': {
      const { request } = entry;
      const body = (
        <span className="row__body">
          <span
            className={
              request.status === 'cancelled' ? 'row__title row__title--dim' : 'row__title'
            }
          >
            {formatMoney(request.fromAmount, request.fromCode)} →{' '}
            {request.toAmount ? formatMoney(request.toAmount, request.toCode) : request.toCode}
          </span>
          <span className="row__sub">
            {KIND_LABELS[request.kind]} · {shortId(request.id)}
            {request.cancelReason ? ` · ${request.cancelReason}` : ''}
          </span>
        </span>
      );

      // Незакрытая заявка ведёт на главную: платят и отменяют её там.
      return isOpen(request.status) ? (
        <button type="button" onClick={onOpenExchange} className="row__tap">
          {body}
          <span className="row__state row__state--live">{outcomeOf(request.status)}</span>
        </button>
      ) : (
        <>
          {body}
          <span className="row__state">{outcomeOf(request.status)}</span>
        </>
      );
    }

    case 'bonus': {
      const { transaction } = entry;
      const spent = transaction.amount.startsWith('-');
      return (
        <>
          <span className="row__body">
            <span className="row__title">
              {transaction.line
                ? `${transaction.line === 1 ? 'Первая' : 'Вторая'} линия`
                : BONUS_KIND_LABELS[transaction.kind]}
            </span>
            <span className="row__sub">
              {transaction.exchangeRequestId
                ? `Заявка ${shortId(transaction.exchangeRequestId)}`
                : 'Движение по баллам'}
              {transaction.comment ? ` · ${transaction.comment}` : ''}
            </span>
          </span>
          <span className={spent ? 'row__amount row__amount--out' : 'row__amount'}>
            {spent ? '' : '+'}
            {formatAmount(transaction.amount)}
          </span>
        </>
      );
    }

    case 'withdrawal': {
      const { request } = entry;
      return (
        <>
          <span className="row__body">
            <span className="row__title">
              Вывод {formatAmount(request.amount)} баллов
            </span>
            <span className="row__sub">
              {WITHDRAWAL_METHOD_LABELS[request.method]}
              {request.network ? ` · ${request.network}` : ''}
              {request.destinationHint ? ` · ${request.destinationHint}` : ''}
              {request.rejectReason ? ` · ${request.rejectReason}` : ''}
            </span>
          </span>
          <span className="row__state">{WITHDRAWAL_STATUS_LABELS[request.status]}</span>
        </>
      );
    }

    case 'card': {
      const { application } = entry;
      return (
        <>
          <span className="row__body">
            <span className="row__title">Заявка на иностранную карту</span>
            <span className="row__sub">Оформляет провайдер</span>
          </span>
          <span className="row__state">{CARD_STATUS_LABELS[application.status]}</span>
        </>
      );
    }
  }
}
