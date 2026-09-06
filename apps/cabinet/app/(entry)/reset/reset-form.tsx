'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Brand } from '@nemo/ui';
import { send } from '@/app/ui/send';

/**
 * Новый пароль по ссылке из письма.
 *
 * Ключ приходит адресом и уходит в запросе: страница его не тратит на
 * открытии — в отличие от подтверждения почты, здесь есть что сделать
 * руками, и потратить ключ на предпросмотре письма значило бы отдать
 * его чужому почтовому фильтру.
 */
export function ResetForm({ token }: { readonly token: string }) {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setComplaint(undefined);
    setBusy(true);

    const result = await send('/api/auth/reset', { token, password });
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    setDone(true);
  }

  return (
    <main className="login">
      <div className="login__card">
        <div className="login__brand">
          <Brand eyebrow="кабинет" />
        </div>
        <p className="login__eyebrow">Новый пароль</p>

        {done ? (
          <>
            <p className="muted">
              Пароль сменён. Все входы, сделанные раньше, закрыты — в том числе на других
              устройствах.
            </p>
            <Link className="btn btn--gold" href="/login">
              Войти
            </Link>
          </>
        ) : (
          <form className="login__form" onSubmit={submit}>
            <label className="field">
              <span className="label">Новый пароль</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <span className="cell__note">Не короче десяти знаков.</span>
            </label>

            {complaint ? <p className="error">{complaint}</p> : undefined}

            <button type="submit" className="btn btn--gold btn--wide" disabled={busy}>
              {busy ? 'Меняем…' : 'Сменить пароль'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
