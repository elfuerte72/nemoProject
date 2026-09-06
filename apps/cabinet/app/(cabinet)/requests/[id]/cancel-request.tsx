'use client';

import { useState } from 'react';
import { send } from '@/app/ui/send';

/**
 * Отмена своей заявки — необратимое, и потому спрашивается
 * подтверждение: раскрытием строки, как в панели, а не отдельным
 * экраном. Кнопка при этом не гаснет до ответа — погашенная теряет
 * фокус, и работающий с клавиатуры оказывается в начале страницы.
 *
 * Показывается, только пока заявку не взяли в работу; но решает это не
 * разметка, а операция — кнопку можно не показывать, отказывает ядро.
 */
export function CancelRequest({ id }: { readonly id: string }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();

  async function cancel() {
    setBusy(true);
    setComplaint(undefined);

    const result = await send(`/api/requests/${id}/cancel`, {});
    if (!result.ok) {
      setComplaint(result.complaint);
      setBusy(false);
      return;
    }

    // Адресом, а не router.refresh: состояние заявки изменилось, и
    // страница должна прийти заново целиком, вместе с лентой событий.
    window.location.reload();
  }

  return (
    <section className="card">
      <h2 className="card__title">Отменить заявку</h2>
      <p className="card__note">
        Пока её не взяли в работу — можно. Дальше отменяет менеджер: с этого момента по
        заявке уже могли уйти деньги.
      </p>

      {complaint ? <p className="error">{complaint}</p> : undefined}

      {asking ? (
        <div className="row__actions">
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void cancel()}
            aria-busy={busy}
          >
            {busy ? 'Отменяем…' : 'Да, отменить'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setAsking(false)}>
            Оставить
          </button>
        </div>
      ) : (
        <div className="row__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setAsking(true)}>
            Отменить заявку
          </button>
        </div>
      )}
    </section>
  );
}
