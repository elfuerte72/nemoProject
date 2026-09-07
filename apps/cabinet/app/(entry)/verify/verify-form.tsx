'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Brand } from '@nemo/ui';
import { send } from '@/app/ui/send';

/**
 * Кнопка подтверждения. Одна на экране: другого дела у страницы нет, а
 * ключ тратится только по нажатию.
 */
export function VerifyForm({ token }: { readonly token: string }) {
  const [done, setDone] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function confirm(): Promise<void> {
    setComplaint(undefined);
    setBusy(true);

    const result = await send('/api/auth/verify', { token });
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    setDone(true);
  }

  return (
    <main className="state">
      <div className="state__card">
        <div className="login__brand">
          <Brand eyebrow="кабинет" />
        </div>

        {done ? (
          <>
            <h1 className="state__title">Почта подтверждена</h1>
            <p className="state__text">
              Анкета ушла на рассмотрение. О решении мы напишем на этот адрес; войти в кабинет
              можно уже сейчас.
            </p>
            <Link className="btn btn--gold" href="/login">
              Войти
            </Link>
          </>
        ) : (
          <>
            <h1 className="state__title">Подтвердите почту</h1>
            <p className="state__text">
              Ссылка из письма открыта — осталось нажать. Так адрес и подтверждается: анкета
              уйдёт на рассмотрение, а мы напишем сюда же о решении.
            </p>

            {complaint ? <p className="error">{complaint}</p> : undefined}

            {token ? (
              <button
                type="button"
                className="btn btn--gold"
                onClick={() => void confirm()}
                aria-busy={busy}
              >
                {busy ? 'Подтверждаем…' : 'Подтвердить почту'}
              </button>
            ) : (
              <p className="state__text">
                Ссылка неполная: откройте её из письма целиком — вместе с ключом после
                «token=».
              </p>
            )}

            <p className="muted">
              Ссылка не сработала? Она живёт сутки и срабатывает один раз. Войдите — и на
              экране «подтвердите почту» будет кнопка выслать письмо заново.
            </p>
            <Link className="btn btn--ghost" href="/login">
              К входу
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
