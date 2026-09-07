'use client';

import { useState, type FormEvent } from 'react';
import { send } from '@/app/ui/send';

/**
 * Смена пароля. Обрывает все входы разом — это и есть её смысл, и
 * сказано об этом до нажатия, а не после: иначе выброшенный из
 * кабинета решит, что что-то сломалось.
 */
export function PasswordForm() {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [complaint, setComplaint] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setComplaint(undefined);
    setBusy(true);

    const result = await send('/api/password', { currentPassword, newPassword });
    if (!result.ok) {
      setComplaint(result.complaint);
      setBusy(false);
      return;
    }

    // Поколение сменилось, и текущая кука больше не подходит: входить
    // надо заново — здесь и на других устройствах.
    window.location.href = '/login';
  }

  return (
    <section className="card">
      <h2 className="card__title">Пароль</h2>
      <p className="card__note">
        После смены придётся войти заново — здесь и везде, где вы входили раньше.
      </p>

      <form className="login__form" onSubmit={submit}>
        <label className="field">
          <span className="label">Текущий пароль</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrent(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="label">Новый пароль</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNext(event.target.value)}
            required
          />
          <span className="cell__note">Не короче десяти знаков.</span>
        </label>

        {complaint ? <p className="error">{complaint}</p> : undefined}

        <div className="row__actions">
          <button type="submit" className="btn btn--gold" disabled={busy}>
            {busy ? 'Меняем…' : 'Сменить пароль'}
          </button>
        </div>
      </form>
    </section>
  );
}
