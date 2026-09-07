'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Brand } from '@nemo/ui';
import { send } from '@/app/ui/send';

/**
 * «Забыли пароль»: почта и ссылка в письме.
 *
 * Ответ один на знакомый и незнакомый адрес — и это правило, а не
 * недосказанность: иначе форма стала бы способом перебирать, кто здесь
 * заведён.
 */
export function ForgotForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setComplaint(undefined);
    setBusy(true);

    const result = await send('/api/auth/forgot', { email });
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    setSent(true);
  }

  return (
    <main className="login">
      <div className="login__card">
        <div className="login__brand">
          <Brand eyebrow="кабинет" />
        </div>
        <p className="login__eyebrow">Смена пароля</p>

        {sent ? (
          <>
            <p className="muted">
              Если такой кабинет есть, письмо со ссылкой уже отправлено. Ссылка работает час.
            </p>
            <Link className="btn btn--soft" href="/login">
              К входу
            </Link>
          </>
        ) : (
          <form className="login__form" onSubmit={submit}>
            <label className="field">
              <span className="label">Почта</span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            {complaint ? <p className="error">{complaint}</p> : undefined}

            <button type="submit" className="btn btn--gold btn--wide" disabled={busy}>
              {busy ? 'Отправляем…' : 'Прислать ссылку'}
            </button>
            <p className="muted">
              <Link href="/login">Вспомнил пароль</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
