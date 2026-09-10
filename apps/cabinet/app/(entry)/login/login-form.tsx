'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Brand } from '@nemo/ui';
import { send } from '@/app/ui/send';

/**
 * Вход мерчанта.
 *
 * Отказ один на «нет такой почты» и «пароль не тот» — так отвечает
 * операция, и форма его не расшифровывает: разные слова говорили бы
 * подбирающему, на каком шаге он остановился.
 */
export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [complaint, setComplaint] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setComplaint(undefined);
    setBusy(true);

    const result = await send('/api/auth/login', { email, password });
    if (!result.ok) {
      setComplaint(result.complaint);
      setBusy(false);
      return;
    }

    // Адресом, а не router: после появления куки нужен свежий запрос,
    // иначе оболочка приедет из кэша, собранного до входа.
    window.location.href = '/dashboard';
  }

  return (
    <main className="login">
      <div className="login__card">
        <div className="login__brand">
          <Brand eyebrow="кабинет" />
        </div>
        <p className="login__eyebrow">Вход для мерчантов</p>

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
          <label className="field">
            <span className="label">Пароль</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {complaint ? <p className="error">{complaint}</p> : undefined}

          <button type="submit" className="btn btn--gold btn--wide" disabled={busy}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>

        <p className="muted">
          <Link href="/forgot">Забыли пароль?</Link>
          {' · '}
          <Link href="/register">Завести кабинет</Link>
        </p>
      </div>
    </main>
  );
}
