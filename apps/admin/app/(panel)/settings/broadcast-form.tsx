'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { BroadcastView } from '@nemo/core';
import { Moment } from '@nemo/ui';
import {
  attemptFor,
  BROADCAST_ATTEMPT_KEY,
  parseStoredAttempt,
  type BroadcastAttempt,
} from '@/lib/broadcast-draft';

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/*
 * Хранилище вкладки бывает недоступно — приватное окно, запрет сайта.
 * Тогда попытка живёт в памяти страницы: повтор без перезагрузки
 * по-прежнему узнаётся.
 */
function readStoredAttempt(): BroadcastAttempt | undefined {
  try {
    return parseStoredAttempt(window.sessionStorage.getItem(BROADCAST_ATTEMPT_KEY));
  } catch {
    return undefined;
  }
}

function storeAttempt(attempt: BroadcastAttempt | undefined): void {
  try {
    if (attempt === undefined) {
      window.sessionStorage.removeItem(BROADCAST_ATTEMPT_KEY);
    } else {
      window.sessionStorage.setItem(BROADCAST_ATTEMPT_KEY, JSON.stringify(attempt));
    }
  } catch {
    // Нечего делать: попытка остаётся в памяти страницы.
  }
}

/**
 * Ручная рассылка.
 *
 * Сообщения уходят только клиентам с действующим согласием — список
 * собирает операция, и обойти его отсюда нельзя. Заблокировавшие бота
 * попадают в недоставленные и рассылку остальным не ломают.
 *
 * Отправка необратима и уходит тысячам людей, поэтому спрашивает
 * подтверждение раскрытием строки, как выплата и отказ. И повтор не
 * рассылает второй раз: запрос на большом списке рвётся по таймауту,
 * пока рассылка идёт дальше, а отправку того же текста ещё раз операция
 * узнаёт по ключу попытки (`lib/broadcast-draft.ts`). До 17 сентября
 * 2026 форма в этом месте говорила «повторите», и повтор уходил всем
 * вторым сообщением.
 */
export function BroadcastForm({
  broadcasts,
  audience,
}: {
  broadcasts: readonly BroadcastView[];
  /** Скольким клиентам с согласием уйдёт рассылка, если отправить сейчас. */
  audience: number;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** Последняя попытка без ответа — на случай, если хранилища вкладки нет. */
  const pending = useRef<BroadcastAttempt | undefined>(undefined);

  function edit(value: string) {
    setBody(value);
    setConfirming(false);
    setNotice(undefined);
  }

  async function send() {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    // Попытка запоминается до запроса: ответ может не прийти вовсе, а
    // повтор того же текста обязан уйти с тем же ключом.
    const attempt = attemptFor(body, pending.current ?? readStoredAttempt(), newKey);
    pending.current = attempt;
    storeAttempt(attempt);
    try {
      const response = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: attempt.body, idempotencyKey: attempt.key }),
      });
      const payload = (await response.json()) as { error?: string; repeated?: boolean };
      if (!response.ok) {
        // Попытка не забывается: отказ мог прийти уже после того, как
        // рассылка заведена, и повтор должен её узнать.
        setError(payload.error ?? 'Рассылка не отправлена');
        return;
      }
      if (payload.repeated) {
        setNotice(
          'Этот текст уже отправляли, второй раз он не уходит. Сколько дошло — в списке ниже; ' +
            '«не завершена» там значит, что рассылка ещё идёт или оборвалась.',
        );
      }
      pending.current = undefined;
      storeAttempt(undefined);
      setBody('');
      setConfirming(false);
      router.refresh();
    } catch {
      setError(
        'Ответа от сервера не дождались, а рассылка могла уже пойти. Отправьте тот же текст ' +
          'ещё раз, хоть после обновления страницы: второй раз он не уйдёт, а в списке ниже ' +
          'появится, сколько дошло.',
      );
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
          onChange={(event) => edit(event.target.value)}
          rows={4}
        />
      </label>
      <div className="row__actions">
        {/*
          Кнопка не гаснет открытым подтверждением: погашенная теряет
          фокус, и работающий с клавиатуры оказывается в начале страницы.
        */}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy || !body.trim()}
          aria-expanded={confirming}
          className="btn btn--gold"
        >
          Отправить рассылку
        </button>
      </div>
      {confirming && body.trim() ? (
        <div className="confirm">
          <p className="muted">
            Клиентов с согласием на рассылку сейчас {audience}. Сообщение уйдёт каждому, и
            отозвать его будет нельзя.
          </p>
          <div className="row__actions">
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy}
              className="btn btn--gold"
            >
              {busy ? 'Отправляем…' : 'Да, разослать'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="btn btn--ghost"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : undefined}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}
      {notice ? (
        <p className="card__note" role="status">
          {notice}
        </p>
      ) : undefined}

      {broadcasts.length === 0 ? (
        <p className="empty">
          Рассылок ещё не было. Отправленная встанет сюда — с числом получателей и тем,
          скольким она дошла.
        </p>
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
                    <Moment at={new Date(broadcast.createdAt).toISOString()} /> · получателей{' '}
                    {broadcast.recipients} · доставлено {broadcast.delivered} · не удалось{' '}
                    {broadcast.failed}
                    {/*
                      Без отметки о конце рассылка либо ещё идёт, либо
                      оборвалась вместе с процессом: числа выше — сколько
                      успело уйти, и отправлять тот же текст заново не нужно.
                    */}
                    {broadcast.finishedAt === null ? ' · не завершена' : ''}
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
