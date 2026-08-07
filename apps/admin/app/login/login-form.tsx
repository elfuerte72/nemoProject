'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Вход менеджера: кнопка Telegram, затем одноразовый код.
 *
 * Пароля нет и не будет — заводить его пришлось бы каждому сотруднику,
 * а хранить сервису. Telegram Login отвечает за «это точно вы», код из
 * приложения-аутентификатора — за «это точно не угнанный аккаунт».
 *
 * Тому, чей ключ ещё ни разу не срабатывал, вместе с полем для кода
 * приходит и сам ключ: кодом для камеры и строкой. Иначе сотрудник
 * упирается в поле, а взять код ему неоткуда, — так и было, пока ключ
 * видел только заводивший его администратор. Отдаёт ключ ядро и только
 * до первого сошедшегося кода (`packages/core/src/staff.ts`).
 */
export function LoginForm({ devLogin = false }: { devLogin?: boolean }) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<'telegram' | 'code'>('telegram');
  const [enrollment, setEnrollment] = useState<{ secret: string; qr: string }>();
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
        const body = (await response.json()) as {
          error?: string;
          enrollment?: { secret: string; qr: string };
        };
        if (!response.ok) {
          setError(body.error ?? 'Вход не выполнен');
          return;
        }
        setEnrollment(body.enrollment);
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
            {devLogin ? <DevLogin onError={setError} /> : undefined}
          </>
        ) : (
          <form onSubmit={submitCode} className="login__form">
            {enrollment ? (
              /*
               * Ключ показывается выше поля, потому что порядок действий
               * такой: сначала завести его в приложении, потом брать
               * оттуда код. Поле для кода над кодом для камеры читалось
               * бы как «введите то, чего у вас нет».
               */
              <div className="login__enroll">
                <span className="label">Сначала добавьте ключ в приложение</span>
                <p className="muted">
                  Установите Google Authenticator (или Яндекс Ключ, 1Password) и наведите
                  его камеру на код. Запись появится под названием «nemo» и будет
                  подписана вашим Telegram и ролью.
                </p>
                {/*
                  Разметка кода приходит с сервера и содержит только
                  фигуры, собранные из ключа, — ни ввода пользователя, ни
                  ссылок.
                */}
                <div
                  className="secret__qr"
                  dangerouslySetInnerHTML={{ __html: enrollment.qr }}
                />
                <span className="label">Если камеры нет — ключ вручную</span>
                <code className="secret__key mono">{enrollment.secret}</code>
                <p className="muted">
                  Показывается, пока ключом ни разу не вошли: первый сошедшийся код
                  закрывает этот показ. Потерянный после этого ключ выдаёт заново
                  администратор.
                </p>
              </div>
            ) : undefined}
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
                // Фокус уводит экран к полю, а над полем в этот раз стоит
                // код для камеры, ради которого экран и открыт.
                autoFocus={!enrollment}
              />
            </label>
            {/*
              Иначе человек ждёт код в сообщении и не находит его: слово
              «приложение» он читает как Telegram, а больше на экране
              подсказок нет. Запись в приложении подписана его Telegram и
              ролью — по ней он и найдёт нужную строку. Тому, кто только
              что завёл ключ, всё это уже сказано выше.
            */}
            <p className="muted">
              {enrollment
                ? 'Шесть цифр, которые показывает приложение под записью «nemo». Код меняется каждые 30 секунд и никуда не присылается: приложение считает его само.'
                : 'Шесть цифр из Google Authenticator, Яндекс Ключа или другого приложения, куда добавлен ваш ключ — запись подписана «nemo». Код меняется каждые 30 секунд и никуда не присылается: приложение считает его само.'}
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

/**
 * Вход на своей машине: Telegram ID заведённого сотрудника.
 *
 * Ни подписи, ни кода — но и ни одного нового права: сотрудника ищет та
 * же операция, что и настоящий вход, и незаведённому отказывает так же.
 * Сказано об этом прямо на экране, чтобы блок не спутали с рабочим
 * входом.
 */
function DevLogin({ onError }: { onError: (message: string | undefined) => void }) {
  const [telegramUserId, setTelegramUserId] = useState('');
  const [busy, setBusy] = useState(false);

  async function enter(event: React.FormEvent) {
    event.preventDefault();
    onError(undefined);
    setBusy(true);
    try {
      const response = await fetch('/api/auth/dev', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ telegramUserId: telegramUserId.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        onError(body.error ?? 'Вход не выполнен');
        return;
      }
      // Адресом, а не router: после установки куки нужен свежий запрос,
      // иначе разделы приедут из кэша страницы входа.
      window.location.href = '/';
    } catch {
      onError('Вход не выполнен');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={enter} className="login__dev">
      <span className="label">Вход для разработки</span>
      <p className="muted">
        Виджет Telegram на своей машине не работает — ему нужен настоящий домен. Здесь
        пропускаются оба фактора, но не проверка сотрудника: войти можно только тем, кто
        заведён и кому выдан ключ. На сервере этот вход выключен.
      </p>
      <input
        className="input"
        value={telegramUserId}
        onChange={(event) => setTelegramUserId(event.target.value)}
        inputMode="numeric"
        placeholder="Telegram ID сотрудника"
        aria-label="Telegram ID сотрудника"
      />
      <button
        type="submit"
        disabled={busy || !telegramUserId.trim()}
        className="btn btn--soft btn--wide"
      >
        Войти без второго фактора
      </button>
    </form>
  );
}
