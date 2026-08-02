'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BroadcastView } from '@nemo/core';

/**
 * Ручная рассылка.
 *
 * Сообщения уходят только клиентам с действующим согласием — список
 * собирает операция, и обойти его отсюда нельзя. Заблокировавшие бота
 * попадают в недоставленные и рассылку остальным не ломают.
 */
export function BroadcastForm({ broadcasts }: { broadcasts: readonly BroadcastView[] }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function send() {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? 'Рассылка не отправлена');
        return;
      }
      setBody('');
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">Рассылка</h2>
      <p className="card__note">
        Уйдёт только тем, кто дал согласие. Отправка идёт порциями с паузой — на большом
        списке это занимает время, дождитесь результата.
      </p>
      <label className="field">
        <span className="label">Текст рассылки</span>
        <textarea
          className="input"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
        />
      </label>
      <div className="row__actions">
        <button
          type="button"
          onClick={send}
          disabled={busy || !body.trim()}
          className="btn btn--gold"
        >
          {busy ? 'Отправляем…' : 'Отправить рассылку'}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : undefined}

      {broadcasts.length === 0 ? (
        <p className="empty">Рассылок ещё не было.</p>
      ) : (
        <>
          <div className="section__head">
            <h3 className="section__title">Прошлые рассылки</h3>
            <span className="section__rule" />
          </div>
          <ul className="rows">
            {broadcasts.map((broadcast) => (
              <li key={broadcast.id} className="row">
                <div className="row__main">
                  <span className="row__meta">{broadcast.body}</span>
                  <span className="row__meta">
                    {new Date(broadcast.createdAt).toLocaleString('ru-RU')} · получателей{' '}
                    {broadcast.recipients} · доставлено {broadcast.delivered} · не удалось{' '}
                    {broadcast.failed}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
