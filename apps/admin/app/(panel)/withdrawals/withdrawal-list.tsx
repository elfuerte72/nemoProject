'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { canTransitionWithdrawal } from '@nemo/types';
import type { WithdrawalRequestView } from '@nemo/core';
import { formatAmount } from '@/lib/format';
import {
  pillClass,
  WITHDRAWAL_METHOD_LABELS,
  WITHDRAWAL_STATUS_LABELS,
  WITHDRAWAL_STATUS_TONES,
} from '@/lib/labels';

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
    return <p className="empty">Заявок на вывод нет.</p>;
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : undefined}
      <ul className="rows">
        {requests.map((request) => (
          <li key={request.id} className="row row--stack">
            <div className="row__side" style={{ justifyContent: 'space-between' }}>
              <div className="row__main">
                <span className="row__title">
                  {formatAmount(request.amount)} баллов ·{' '}
                  {WITHDRAWAL_METHOD_LABELS[request.method]}
                  {/*
                    Сеть стоит рядом со способом, а не в реквизитах:
                    перевод не в ту сеть не возвращается, и увидеть её
                    менеджер должен до того, как откроет адрес.
                  */}
                  {request.network ? ` · ${request.network}` : ''}
                </span>
                <span className="row__meta">
                  клиент {request.clientId} · {request.destinationHint ?? 'без реквизитов'}
                </span>
              </div>
              <span className={pillClass(WITHDRAWAL_STATUS_TONES[request.status])}>
                {WITHDRAWAL_STATUS_LABELS[request.status]}
              </span>
            </div>

            {destinations[request.id] ? (
              <div className="field">
                <span className="label">Реквизиты получения</span>
                <span className="mono">{destinations[request.id]}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => act(request.id, { action: 'reveal' })}
                disabled={busy}
                className="link"
              >
                Показать реквизиты получения
              </button>
            )}

            <div className="row__actions">
              {canTransitionWithdrawal(request.status, 'approved') ? (
                <button
                  type="button"
                  onClick={() => act(request.id, { action: 'approve' })}
                  disabled={busy}
                  className="btn btn--gold"
                >
                  Одобрить
                </button>
              ) : undefined}
              {canTransitionWithdrawal(request.status, 'paid') ? (
                <button
                  type="button"
                  onClick={() => act(request.id, { action: 'pay' })}
                  disabled={busy}
                  className="btn btn--gold"
                >
                  Выплачено — списать баллы
                </button>
              ) : undefined}

              {canTransitionWithdrawal(request.status, 'rejected') ? (
                <>
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: '14rem' }}
                    value={reasons[request.id] ?? ''}
                    onChange={(event) =>
                      setReasons((current) => ({ ...current, [request.id]: event.target.value }))
                    }
                    placeholder="Причина отказа — её увидит клиент"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      act(request.id, { action: 'reject', reason: reasons[request.id] ?? '' })
                    }
                    disabled={busy}
                    className="btn btn--danger"
                  >
                    Отклонить
                  </button>
                </>
              ) : undefined}
            </div>

            {request.rejectReason ? (
              <span className="row__meta">Причина отказа: {request.rejectReason}</span>
            ) : undefined}
          </li>
        ))}
      </ul>
    </>
  );
}
