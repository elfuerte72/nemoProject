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
import { Moment } from '@/app/ui/moment';

/**
 * Очередь выплат по бонусным баллам.
 *
 * Реквизиты получения открываются по нажатию, а не вместе со списком:
 * менеджеру они нужны в момент самой выплаты, а не всё время, пока
 * открыт экран. Каждое открытие пишется в журнал доступа, и список,
 * раскрывающий их сам, наполнял бы журнал записями ни о чём.
 */

/** Клиент — bigint, время — Date: в клиентский компонент едут строками. */
type WithdrawalForDisplay = Omit<WithdrawalRequestView, 'clientId' | 'createdAt' | 'paidAt'> & {
  clientId: string;
  createdAt: string;
};

type Pending = { id: string; action: 'pay' | 'reject' } | undefined;

/** Ждёт ли подтверждения именно это действие именно на этой заявке. */
function isPending(pending: Pending, id: string, action: 'pay' | 'reject'): boolean {
  return pending?.id === id && pending.action === action;
}

export function WithdrawalList({ requests }: { requests: readonly WithdrawalForDisplay[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  /**
   * Нажатое действие, которого ещё не подтвердили. Отметка о выплате и
   * отказ необратимы — первая списывает баллы, второй уходит клиенту, —
   * и стоят они в одном ряду с безобидными кнопками.
   */
  const [pending, setPending] = useState<{ id: string; action: 'pay' | 'reject' }>();

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
      setPending(undefined);
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  if (requests.length === 0) {
    return (
      <p className="empty">
        Заявок на вывод нет. Здесь появятся те, что клиенты подадут со своего бонусного счёта.
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

      <div className="table__head table--withdrawals">
        <span>Сумма</span>
        <span>Клиент</span>
        <span>Куда</span>
        <span>Состояние</span>
        <span>Что сделать</span>
      </div>

      <ul className="table table--withdrawals">
        {requests.map((request) => {
          const waiting = WITHDRAWAL_STATUS_TONES[request.status] === 'wait';

          return (
            <li
              key={request.id}
              className={waiting ? 'table__item table__item--fresh' : 'table__item table__item--settled'}
            >
              <div className="table__row">
                <span className="cell cell--num" data-label="Сумма">
                  <span className="cell__value">{formatAmount(request.amount)} баллов</span>
                  <span className="cell__note">
                    подана <Moment at={request.createdAt} mode="day" />
                  </span>
                </span>

                <span className="cell" data-label="Клиент">
                  <span className="cell__value">{request.clientId}</span>
                </span>

                {/*
                  Сеть стоит рядом со способом, а не в реквизитах:
                  перевод не в ту сеть не возвращается, и увидеть её
                  менеджер должен до того, как откроет адрес.
                */}
                <span className="cell" data-label="Куда">
                  <span className="cell__value">
                    {WITHDRAWAL_METHOD_LABELS[request.method]}
                    {request.network ? ` · ${request.network}` : ''}
                  </span>
                  <span className="cell__note">
                    {request.destinationHint ?? 'реквизитов нет'}
                  </span>
                </span>

                <span className="cell" data-label="Состояние">
                  <span className={pillClass(WITHDRAWAL_STATUS_TONES[request.status])}>
                    {WITHDRAWAL_STATUS_LABELS[request.status]}
                  </span>
                </span>

                <span className="cell cell--actions" data-label="Что сделать">
                  {destinations[request.id] === undefined ? (
                    <button
                      type="button"
                      onClick={() => act(request.id, { action: 'reveal' })}
                      disabled={busy}
                      className="btn btn--ghost"
                    >
                      Реквизиты
                    </button>
                  ) : undefined}

                  {canTransitionWithdrawal(request.status, 'approved') ? (
                    <button
                      type="button"
                      onClick={() => act(request.id, { action: 'approve' })}
                      disabled={busy}
                      className="btn btn--soft"
                    >
                      Одобрить
                    </button>
                  ) : undefined}

                  {/*
                    Отметка о выплате списывает баллы, поэтому она и
                    названа выплатой, а не «готово»: нажимают её после
                    перевода, а не вместо него. Само списание — вторым
                    нажатием, в раскрытой части строки.
                  */}
                  {canTransitionWithdrawal(request.status, 'paid') ? (
                    <button
                      type="button"
                      onClick={() => setPending({ id: request.id, action: 'pay' })}
                      disabled={busy || isPending(pending, request.id, 'pay')}
                      className="btn btn--gold"
                    >
                      Выплачено
                    </button>
                  ) : undefined}

                  {canTransitionWithdrawal(request.status, 'rejected') ? (
                    <button
                      type="button"
                      onClick={() => setPending({ id: request.id, action: 'reject' })}
                      disabled={busy || isPending(pending, request.id, 'reject')}
                      className="btn btn--ghost btn--danger"
                    >
                      Отклонить
                    </button>
                  ) : undefined}

                  {canTransitionWithdrawal(request.status, 'approved') ||
                  canTransitionWithdrawal(request.status, 'paid') ||
                  canTransitionWithdrawal(request.status, 'rejected') ? undefined : (
                    <span className="cell__note">Заявка закрыта</span>
                  )}
                </span>
              </div>

              {destinations[request.id] !== undefined || pending?.id === request.id ? (
                <div className="table__more">
                  {destinations[request.id] !== undefined ? (
                    <div className="field">
                      <span className="label">Реквизиты получения</span>
                      <span className="mono">{destinations[request.id]}</span>
                    </div>
                  ) : undefined}

                  {isPending(pending, request.id, 'pay') ? (
                    <div className="field">
                      <p className="muted">
                        Перевод уже сделан? Отметка спишет {formatAmount(request.amount)} баллов со
                        счёта клиента, и отменить её будет нельзя.
                      </p>
                      <div className="row__actions">
                        <button
                          type="button"
                          onClick={() => act(request.id, { action: 'pay' })}
                          disabled={busy}
                          className="btn btn--gold"
                        >
                          Да, выплачено — списать баллы
                        </button>
                        <button
                          type="button"
                          onClick={() => setPending(undefined)}
                          disabled={busy}
                          className="btn btn--ghost"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : undefined}

                  {isPending(pending, request.id, 'reject') ? (
                    <div className="field">
                      <label className="label" htmlFor={`reason-${request.id}`}>
                        Причина отказа — её увидит клиент
                      </label>
                      <input
                        id={`reason-${request.id}`}
                        className="input"
                        value={reasons[request.id] ?? ''}
                        onChange={(event) =>
                          setReasons((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))
                        }
                        placeholder="Например: реквизиты не принадлежат клиенту"
                      />
                      <div className="row__actions">
                        <button
                          type="button"
                          onClick={() =>
                            act(request.id, {
                              action: 'reject',
                              reason: reasons[request.id] ?? '',
                            })
                          }
                          disabled={busy}
                          className="btn btn--danger"
                        >
                          Отклонить заявку
                        </button>
                        <button
                          type="button"
                          onClick={() => setPending(undefined)}
                          disabled={busy}
                          className="btn btn--ghost"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : undefined}
                </div>
              ) : undefined}

              {request.rejectReason ? (
                <div className="table__more">
                  <span className="cell__note">Причина отказа: {request.rejectReason}</span>
                </div>
              ) : undefined}
            </li>
          );
        })}
      </ul>
    </>
  );
}
