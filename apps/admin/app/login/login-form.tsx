'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Вход менеджера: кнопка Telegram, затем одноразовый код.
 *
 * Пароля нет и не будет — заводить его пришлось бы каждому сотруднику,
 * а хранить сервису. Telegram Login отвечает за «это точно вы», код из
 * приложения-аутентификатора — за «это точно не угнанный аккаунт».
 */
export function LoginForm() {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<'telegram' | 'code'>('telegram');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
    if (!username || !widgetRef.current) return;

    // Виджет присылает данные в глобальную функцию: другого способа
    // получить их от него нет.
    window.onTelegramAuth = async (payload) => {
      setError(undefined);
      try {
        const response = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(body.error ?? 'Вход не выполнен');
          return;
        }
        setStage('code');
      } catch {
        setError('Вход не выполнен');
      }
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', username);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    widgetRef.current.appendChild(script);
  }, []);

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch('/api/auth/totp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Аутентификаторы показывают код с пробелом посередине, и
        // скопированный вместе с ним он не должен считаться неверным.
        body: JSON.stringify({ code: code.replace(/\s+/g, '') }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? 'Код не подошёл');
        return;
      }
      window.location.href = '/';
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.card}>
      <h1 style={styles.heading}>Админ-панель</h1>

      {stage === 'telegram' ? (
        <>
          <p style={styles.muted}>
            Вход по Telegram. Доступ получают только заведённые сотрудники.
          </p>
          <div ref={widgetRef} />
        </>
      ) : (
        <form onSubmit={submitCode} style={styles.form}>
          <label style={styles.label} htmlFor="totp">
            Код из приложения-аутентификатора
          </label>
          <input
            id="totp"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            style={styles.input}
          />
          {/*
            Иначе человек ждёт код в сообщении и не находит его: слово
            «приложение» он читает как Telegram, а больше на экране
            подсказок нет.
          */}
          <p style={styles.muted}>
            Шесть цифр из Google Authenticator, Яндекс Ключа или другого приложения,
            куда добавлен ваш ключ. Код меняется каждые 30 секунд, и никуда не
            присылается — приложение считает его само.
          </p>
          <button type="submit" disabled={busy} style={styles.button}>
            Войти
          </button>
        </form>
      )}

      {error ? <p style={styles.error}>{error}</p> : undefined}
    </div>
  );
}

declare global {
  interface Window {
    onTelegramAuth?: (payload: Record<string, string | number>) => void;
  }
}

const styles = {
  card: {
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 380,
    margin: '4rem auto',
    padding: '0 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  heading: { fontSize: '1.25rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  label: { fontSize: '0.9rem', fontWeight: 600 },
  input: { padding: '0.6rem', fontSize: '1.1rem', letterSpacing: '0.2em' },
  button: { padding: '0.7rem', fontSize: '1rem', fontWeight: 600 },
  muted: { opacity: 0.7, fontSize: '0.85rem', lineHeight: 1.45 },
  error: { color: '#c0392b', fontSize: '0.9rem' },
} satisfies Record<string, React.CSSProperties>;
