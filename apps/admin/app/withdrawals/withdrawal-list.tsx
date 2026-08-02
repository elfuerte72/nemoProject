'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { canTransitionWithdrawal } from '@nemo/types';
import type { WithdrawalRequestView } from '@nemo/core';
import { WITHDRAWAL_METHOD_LABELS, WITHDRAWAL_STATUS_LABELS } from '@/lib/labels';

/**
 * Очередь выплат по бонусным баллам.
 *
 * Реквизиты получения открываются по нажатию, а не вместе со списком:
 * менеджеру они нужны в момент самой выплаты, а не всё время, пока
 * открыт экран.
 */

type WithdrawalForDisplay = Omit<WithdrawalRequestView, 'clientId'> & { clientId: string };

export function WithdrawalList({ requests }: { requests: readonly WithdrawalForDisplay[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [destinations, setDestinations] = useState<Record<string, string>>({});

  async function act(id: string, body: Record<string, string>): Promise<void> {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch(`/api/withdrawals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string; destination?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Действие не выполнено');
        return;
      }
      if (payload.destination !== undefined) {
        setDestinations((current) => ({ ...current, [id]: payload.destination! }));
        return;
      }
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  if (requests.length === 0) {
    return <p style={styles.muted}>Заявок на вывод нет.</p>;
  }

  return (
    <>
      {error ? <p style={styles.error}>{error}</p> : undefined}
      <ul style={styles.list}>
        {requests.map((request) => (
          <li key={request.id} style={styles.item}>
            <div style={styles.title}>
              {request.amount} баллов · {WITHDRAWAL_METHOD_LABELS[request.method]}
            </div>
            <div style={styles.muted}>
              {WITHDRAWAL_STATUS_LABELS[request.status]} · клиент {request.clientId} ·{' '}
              {request.destinationHint ?? 'без реквизитов'}
            </div>

            {destinations[request.id] ? (
              <div style={styles.destination}>Реквизиты: {destinations[request.id]}</div>
            ) : (
              <button
                type="button"
                onClick={() => act(request.id, { action: 'reveal' })}
                disabled={busy}
                style={styles.link}
              >
                Показать реквизиты получения
              </button>
            )}

            <div style={styles.row}>
              {canTransitionWithdrawal(request.status, 'approved') ? (
                <button
                  type="button"
                  onClick={() => act(request.id, { action: 'approve' })}
                  disabled={busy}
                  style={styles.button}
                >
                  Одобрить
                </button>
              ) : undefined}
              {canTransitionWithdrawal(request.status, 'paid') ? (
                <button
                  type="button"
                  onClick={() => act(request.id, { action: 'pay' })}
                  disabled={busy}
                  style={styles.button}
                >
                  Выплачено — списать баллы
                </button>
              ) : undefined}
            </div>

            {canTransitionWithdrawal(request.status, 'rejected') ? (
              <div style={styles.row}>
                <input
                  value={reasons[request.id] ?? ''}
                  onChange={(event) =>
                    setReasons((current) => ({ ...current, [request.id]: event.target.value }))
                  }
                  placeholder="Причина отказа — её увидит клиент"
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={() =>
                    act(request.id, { action: 'reject', reason: reasons[request.id] ?? '' })
                  }
                  disabled={busy}
                  style={styles.button}
                >
                  Отклонить
                </button>
              </div>
            ) : undefined}

            {request.rejectReason ? (
              <div style={styles.muted}>Причина отказа: {request.rejectReason}</div>
            ) : undefined}
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
  row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  input: { flex: 1, minWidth: '12rem', padding: '0.5rem', fontSize: '0.95rem' },
  button: { padding: '0.5rem 0.8rem', fontSize: '0.9rem' },
  destination: { fontSize: '0.9rem', wordBreak: 'break-all', userSelect: 'all' },
  link: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: '0.85rem',
    textDecoration: 'underline',
    cursor: 'pointer',
    color: 'inherit',
    alignSelf: 'flex-start',
  },
  muted: { opacity: 0.7, fontSize: '0.85rem' },
  error: { color: '#c0392b', fontSize: '0.9rem' },
} satisfies Record<string, React.CSSProperties>;
