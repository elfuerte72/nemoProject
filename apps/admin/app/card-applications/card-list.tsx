'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CardApplicationView } from '@nemo/core';
import { cardApplicationTransitions } from '@nemo/types';
import { CARD_STATUS_LABELS } from '@/lib/labels';

/**
 * Заявки на европейскую карту.
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
    return <p style={styles.muted}>Заявок на карту нет.</p>;
  }

  return (
    <>
      {error ? <p style={styles.error}>{error}</p> : undefined}
      <ul style={styles.list}>
        {applications.map((application) => (
          <li key={application.id} style={styles.item}>
            <div style={styles.title}>Клиент {application.clientId}</div>
            <div style={styles.muted}>
              {CARD_STATUS_LABELS[application.status]} · подана{' '}
              {new Date(application.createdAt).toLocaleDateString('ru-RU')}
              {application.providerReference
                ? ` · у провайдера ${application.providerReference}`
                : ''}
            </div>
            <input
              value={references[application.id] ?? application.providerReference ?? ''}
              onChange={(event) =>
                setReferences((current) => ({
                  ...current,
                  [application.id]: event.target.value,
                }))
              }
              placeholder="Номер заявки у провайдера"
              style={styles.input}
            />
            <div style={styles.row}>
              {cardApplicationTransitions[application.status].map((next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => update(application.id, next)}
                  disabled={busy}
                  style={styles.button}
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

const styles = {
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  item: {
    borderTop: '1px solid rgba(128,128,128,0.25)',
    paddingTop: '0.7rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
  },
  title: { fontWeight: 600 },
  row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  input: { padding: '0.5rem', fontSize: '0.95rem', maxWidth: '20rem' },
  button: { padding: '0.5rem 0.8rem', fontSize: '0.9rem' },
  muted: { opacity: 0.7, fontSize: '0.85rem' },
  error: { color: '#c0392b', fontSize: '0.9rem' },
} satisfies Record<string, React.CSSProperties>;
