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
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-radius', '12');
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
    <main className="login">
      <div className="login__card">
        <div>
          <div className="login__brand">nemo</div>
          <p className="login__eyebrow">Админ-панель</p>
        </div>

        {stage === 'telegram' ? (
          <>
            <p className="muted">
              Вход по Telegram. Доступ получают только заведённые сотрудники.
            </p>
            <div ref={widgetRef} className="login__widget" />
          </>
        ) : (
          <form onSubmit={submitCode} className="login__form">
            <label className="field">
              <span className="label">Код из приложения</span>
              <input
                id="totp"
                className="input login__code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                placeholder="000000"
                autoFocus
              />
            </label>
            {/*
              Иначе человек ждёт код в сообщении и не находит его: слово
              «приложение» он читает как Telegram, а больше на экране
              подсказок нет. Запись в приложении подписана его Telegram и
              ролью — по ней он и найдёт нужную строку.
            */}
            <p className="muted">
              Шесть цифр из Google Authenticator, Яндекс Ключа или другого приложения,
              куда добавлен ваш ключ — запись подписана «nemo». Код меняется каждые
              30 секунд и никуда не присылается: приложение считает его само.
            </p>
            <button type="submit" disabled={busy} className="btn btn--gold btn--wide">
              Войти
            </button>
          </form>
        )}

        {error ? <p className="error">{error}</p> : undefined}
      </div>
    </main>
  );
}

declare global {
  interface Window {
    onTelegramAuth?: (payload: Record<string, string | number>) => void;
  }
}
