'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CardApplicationView } from '@nemo/core';
import { cardApplicationTransitions } from '@nemo/types';
import { CARD_STATUS_LABELS, CARD_STATUS_TONES, pillClass } from '@/lib/labels';

/**
 * Заявки на виртуальную карту.
 *
 * Сервис карту не выпускает: менеджер переносит сюда то, что сообщил
 * провайдер. Доступные переходы берутся из той же таблицы, по которой
 * отказывает операция, — своя копия правил разошлась бы с ядром молча.
 */

type CardApplicationForDisplay = Omit<CardApplicationView, 'clientId'> & { clientId: string };

export function CardList({
  applications,
}: {
  applications: readonly CardApplicationForDisplay[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [references, setReferences] = useState<Record<string, string>>({});

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
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  if (applications.length === 0) {
    return <p className="empty">Заявок на карту нет.</p>;
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : undefined}
      <ul className="rows">
        {applications.map((application) => (
          <li key={application.id} className="row row--stack">
            <div className="row__side" style={{ justifyContent: 'space-between' }}>
              <div className="row__main">
                <span className="row__title">Клиент {application.clientId}</span>
                <span className="row__meta">
                  подана {new Date(application.createdAt).toLocaleDateString('ru-RU')}
                  {application.providerReference
                    ? ` · у провайдера ${application.providerReference}`
                    : ''}
                </span>
              </div>
              <span className={pillClass(CARD_STATUS_TONES[application.status])}>
                {CARD_STATUS_LABELS[application.status]}
              </span>
            </div>

            <div className="row__actions">
              <input
                className="input"
                style={{ flex: 1, minWidth: '14rem' }}
                value={references[application.id] ?? application.providerReference ?? ''}
                onChange={(event) =>
                  setReferences((current) => ({
                    ...current,
                    [application.id]: event.target.value,
                  }))
                }
                placeholder="Номер заявки у провайдера"
              />
              {/*
                Кнопка на каждый доступный переход: состояние заявки
                приходит от провайдера, и менеджер переносит сюда то, что
                тот сообщил, — выбирать из полного списка ему незачем.
              */}
              {cardApplicationTransitions[application.status].map((next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => update(application.id, next)}
                  disabled={busy}
                  className={next === 'rejected' ? 'btn btn--danger' : 'btn btn--soft'}
                >
                  {CARD_STATUS_LABELS[next]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
