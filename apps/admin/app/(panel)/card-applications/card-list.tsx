'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ManagerCardApplicationView } from '@nemo/core';
import { cardApplicationTransitions } from '@nemo/types';
import { CARD_STATUS_LABELS, CARD_STATUS_TONES, pillClass } from '@/lib/labels';
import { Moment } from '@/app/ui/moment';

/**
 * Заявки на виртуальную карту.
 *
 * Сервис карту не выпускает: менеджер переносит сюда то, что сообщил
 * провайдер. Доступные переходы берутся из той же таблицы, по которой
 * отказывает операция, — своя копия правил разошлась бы с ядром молча.
 */

/**
 * Клиент — bigint, время — Date: ни то, ни другое не переезжает в
 * клиентский компонент само. Строку разбирает уже браузер, и время он
 * покажет в своих часах, а не в серверных.
 */
type CardApplicationForDisplay = Omit<
  ManagerCardApplicationView,
  'clientId' | 'createdAt'
> & {
  clientId: string;
  createdAt: string;
};

export function CardList({
  applications,
}: {
  applications: readonly CardApplicationForDisplay[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [references, setReferences] = useState<Record<string, string>>({});
  /** Заявка, по которой нажат отказ и ещё не подтверждён. */
  const [rejecting, setRejecting] = useState<string>();

  async function update(id: string, status: string): Promise<void> {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch(`/api/card-applications/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status,
          ...(references[id] ? { providerReference: references[id] } : {}),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? 'Действие не выполнено');
        return;
      }
      setRejecting(undefined);
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  if (applications.length === 0) {
    return (
      <p className="empty">
        Заявок на карту нет. Здесь появятся те, что клиенты подадут из приложения.
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}

      <div aria-hidden className="table__head table--cards">
        <span>Клиент</span>
        <span>Подана</span>
        <span>Номер у провайдера</span>
        <span>Состояние</span>
        <span>Перевести в</span>
      </div>

      <ul className="table table--cards">
        {applications.map((application) => {
          const transitions = cardApplicationTransitions[application.status];
          const waiting = CARD_STATUS_TONES[application.status] === 'wait';

          return (
            <li
              key={application.id}
              className={waiting ? 'table__item table__item--fresh' : 'table__item table__item--settled'}
            >
              <div className="table__row">
                <span className="cell">
                  <span className="cell__label">Клиент</span>
                  <span className="cell__value">
                    {application.clientUsername ? `@${application.clientUsername}` : 'Без ника'}
                  </span>
                  <span className="cell__note">{application.clientId}</span>
                </span>

                <span className="cell cell--num">
                  <span className="cell__label">Подана</span>
                  <span className="cell__note">
                    <Moment at={application.createdAt} mode="day" />
                  </span>
                </span>

                {/*
                  Номер сохраняется вместе с переходом — своей кнопки у
                  него нет. Поле доступно всегда, потому что в эту
                  очередь попадают только заявки, которым есть куда
                  переходить: закрытые из неё уходят.
                */}
                <span className="cell">
                  <span className="cell__label">Номер у провайдера</span>
                  <input
                    className="input"
                    value={references[application.id] ?? application.providerReference ?? ''}
                    onChange={(event) =>
                      setReferences((current) => ({
                        ...current,
                        [application.id]: event.target.value,
                      }))
                    }
                    placeholder="Номер у провайдера"
                    aria-label={`Номер заявки клиента ${application.clientId} у провайдера`}
                  />
                </span>

                <span className="cell">
                  <span className="cell__label">Состояние</span>
                  <span className={pillClass(CARD_STATUS_TONES[application.status])}>
                    {CARD_STATUS_LABELS[application.status]}
                  </span>
                </span>

                {/*
                  Кнопка на каждый доступный переход: состояние заявки
                  приходит от провайдера, и менеджер переносит сюда то, что
                  тот сообщил, — выбирать из полного списка ему незачем.
                */}
                <span className="cell cell--actions">
                  <span className="cell__label">Перевести в</span>
                  {transitions.map((next) =>
                    next === 'rejected' ? (
                      // Кнопка не гасится открытым подтверждением:
                      // погашенная теряет фокус, и работающий с
                      // клавиатуры оказывается в начале страницы.
                      <button
                        key={next}
                        type="button"
                        onClick={() => setRejecting(application.id)}
                        disabled={busy}
                        aria-expanded={rejecting === application.id}
                        className="btn btn--ghost btn--danger"
                      >
                        {CARD_STATUS_LABELS[next]}
                      </button>
                    ) : (
                      <button
                        key={next}
                        type="button"
                        onClick={() => update(application.id, next)}
                        disabled={busy}
                        className="btn btn--soft"
                        aria-label={`Перевести заявку клиента ${application.clientId} в состояние «${CARD_STATUS_LABELS[next]}»`}
                      >
                        {CARD_STATUS_LABELS[next]}
                      </button>
                    ),
                  )}
                </span>
              </div>

              {/*
                Отказ подтверждается вторым нажатием: он необратим и
                уходит клиенту уведомлением, а кнопка стоит в одном ряду
                с рабочими переходами.
              */}
              {rejecting === application.id ? (
                <div className="table__more">
                  <p className="muted">
                    Отклонить заявку клиента {application.clientId}? Клиент получит уведомление, и
                    вернуть заявку в работу будет нельзя.
                  </p>
                  <div className="row__actions">
                    <button
                      type="button"
                      onClick={() => update(application.id, 'rejected')}
                      disabled={busy}
                      className="btn btn--danger"
                    >
                      Да, отклонить
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejecting(undefined)}
                      disabled={busy}
                      className="btn btn--ghost"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : undefined}
            </li>
          );
        })}
      </ul>
    </>
  );
}
