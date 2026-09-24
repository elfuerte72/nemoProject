'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, Moment } from '@nemo/ui';
import { DOORS_PATH } from '@/lib/entry';
import { send } from '@/app/ui/send';

export interface SessionRow {
  readonly id: string;
  /** Устройство словами: «macOS · Chrome». */
  readonly device: string;
  readonly address: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  /** Та сессия, из которой смотрят. */
  readonly current: boolean;
}

/**
 * Список своих входов с отключением.
 *
 * Отключение спрашивает подтверждение раскрытием строки, как отзыв
 * ключа: необратимое, и кнопка при этом не гаснет — погашенная теряет
 * фокус. Своё устройство отключить можно, и это выход: об этом сказано
 * на самой кнопке подтверждения.
 */
export function SessionsList({ sessions }: { readonly sessions: readonly SessionRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [confirming, setConfirming] = useState<string>();

  const others = sessions.filter((one) => !one.current).length;

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    setComplaint(undefined);
    const result = await send(`/api/sessions/${id}/revoke`, {});
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    if ((result.data as { signedOut: boolean }).signedOut) {
      window.location.href = DOORS_PATH;
      return;
    }
    setConfirming(undefined);
    router.refresh();
  }

  async function revokeOthers() {
    if (busy) return;
    setBusy(true);
    setComplaint(undefined);
    const result = await send('/api/sessions/revoke-others', {});
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    setConfirming(undefined);
    router.refresh();
  }

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Активные входы</h2>
          <p className="card__note">
            Незнакомое устройство отключите и смените пароль в «Настройках».
          </p>
        </div>
        {others > 0 ? (
          confirming === 'others' ? (
            <span className="row__actions">
              <button
                type="button"
                className="btn btn--danger btn--tiny"
                onClick={() => void revokeOthers()}
                aria-busy={busy}
              >
                Да, отключить {others}
              </button>
              <button type="button" className="btn btn--ghost btn--tiny" onClick={() => setConfirming(undefined)}>
                Оставить
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => setConfirming('others')}>
              Отключить все, кроме этого
            </button>
          )
        ) : undefined}
      </div>

      {complaint ? <p className="error">{complaint}</p> : undefined}

      {sessions.length === 0 ? (
        <EmptyState icon="user" title="Входов нет" text="Появятся после следующего входа в кабинет." />
      ) : (
        <ul className="table table--sessions">
          <li className="table__head" aria-hidden>
            <span>Устройство</span>
            <span>Адрес</span>
            <span>Была активность</span>
            <span>Вход</span>
            <span />
          </li>
          {sessions.map((one) => (
            <li key={one.id} className="table__item">
              <div className="table__row">
                <span className="cell">
                  <span className="cell__label">Устройство</span>
                  <span className="cell__value">
                    {one.device}
                    {one.current ? <span className="pill pill--done session__here">это устройство</span> : undefined}
                  </span>
                </span>
                <span className="cell">
                  <span className="cell__label">Адрес</span>
                  <span className="cell__value mono">{one.address ?? <span className="muted">—</span>}</span>
                </span>
                <span className="cell">
                  <span className="cell__label">Была активность</span>
                  <span className="cell__value">
                    <Moment at={one.lastSeenAt} />
                  </span>
                </span>
                <span className="cell">
                  <span className="cell__label">Вход</span>
                  <span className="cell__value">
                    <Moment at={one.createdAt} />
                  </span>
                </span>
                <span className="cell cell--actions">
                  {confirming === one.id ? (
                    <span className="row__actions">
                      <button
                        type="button"
                        className="btn btn--danger btn--tiny"
                        onClick={() => void revoke(one.id)}
                        aria-busy={busy}
                      >
                        {one.current ? 'Да, выйти здесь' : 'Да, отключить'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--tiny"
                        onClick={() => setConfirming(undefined)}
                      >
                        Оставить
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost btn--tiny"
                      onClick={() => setConfirming(one.id)}
                    >
                      Отключить
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
