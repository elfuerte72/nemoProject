'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AmbassadorView } from '@nemo/core';
import { EmptyState, Moment } from '@nemo/ui';
import { formatAmount } from '@nemo/ui/format';
import { useAction } from '@/lib/use-action';

/**
 * Список премиальных партнёров и заведение нового.
 *
 * Строка отвечает на вопросы в том порядке, в каком их задают: кто это,
 * дошёл ли до кабинета, скольких привёл, сколько заработал, кто его
 * позвал. Ставка сюда не вынесена — она в карточке клиента, и ссылка
 * туда стоит в строке: два места, где правится процент, разошлись бы
 * при первой правке.
 *
 * Снятие спрашивает подтверждение раскрытием строки, и кнопка при этом
 * не гаснет: погашенная теряет фокус, и работающий с клавиатуры
 * оказывается в начале страницы.
 */
export function Ambassadors({
  rows,
  query,
}: {
  readonly rows: readonly AmbassadorView[];
  readonly query: string;
}) {
  return (
    <>
      <AddAmbassador />
      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Заведённые</h2>
            <p className="card__note">
              {rows.length ? `${rows.length} в списке` : 'Пока никого'}
            </p>
          </div>
          <Search query={query} />
        </div>

        {rows.length ? (
          <div className="scroll-x">
            <table className="datatable">
              <thead>
                <tr>
                  <th>Партнёр</th>
                  <th>Вход</th>
                  <th className="num">Привёл</th>
                  <th className="num">Начислено</th>
                  <th>Завёл</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.clientId.toString()} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="spark"
            title={query ? 'Никого не нашли' : 'Премиальных партнёров пока нет'}
            text={
              query
                ? 'Поищите по другой части подписи или по Telegram ID.'
                : 'Заведите первого: нужен его Telegram ID и подпись — чей это канал или чат.'
            }
          />
        )}
      </section>
    </>
  );
}

function Search({ query }: { readonly query: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(query);

  return (
    <form
      className="form-row"
      onSubmit={(event) => {
        event.preventDefault();
        const value = draft.trim();
        router.push(value ? `/referral/ambassadors?q=${encodeURIComponent(value)}` : '/referral/ambassadors');
      }}
    >
      <label className="field field--narrow">
        <span className="label">Поиск</span>
        <input
          className="input"
          value={draft}
          placeholder="Подпись или Telegram ID"
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button type="submit" className="btn btn--ghost">
        Найти
      </button>
    </form>
  );
}

function AddAmbassador() {
  const { busy, error, act } = useAction('/api/ambassadors');
  const [open, setOpen] = useState(false);
  const [telegramUserId, setTelegramUserId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const submit = async () => {
    if (await act({ action: 'add', telegramUserId: telegramUserId.trim(), title, note })) {
      setOpen(false);
      setTelegramUserId('');
      setTitle('');
      setNote('');
    }
  };

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Завести партнёра</h2>
          <p className="card__note">
            Хватит Telegram ID: клиента и ссылку заведём, если человек ни разу не открывал
            приложение
          </p>
        </div>
        <button type="button" className="btn btn--gold" onClick={() => setOpen((was) => !was)}>
          {open ? 'Не заводить' : 'Завести'}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : undefined}

      {open ? (
        <div className="confirm">
          <div className="form-row">
            <label className="field field--narrow">
              <span className="label">Telegram ID</span>
              <input
                className="input"
                value={telegramUserId}
                inputMode="numeric"
                placeholder="7123456789"
                onChange={(event) => setTelegramUserId(event.target.value)}
              />
            </label>
            <label className="field field--wide">
              <span className="label">Подпись</span>
              <input
                className="input"
                value={title}
                placeholder="Канал «Пхукет за рубль»"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span className="label">Заметка</span>
            <textarea
              className="input"
              rows={2}
              value={note}
              placeholder="Зачем завели и о чём договорились"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn--gold"
            disabled={busy || !telegramUserId.trim() || !title.trim()}
            onClick={submit}
          >
            Завести
          </button>
        </div>
      ) : undefined}
    </section>
  );
}

function Row({ row }: { readonly row: AmbassadorView }) {
  const { busy, error, act } = useAction('/api/ambassadors');
  const [confirming, setConfirming] = useState(false);
  const id = row.clientId.toString();
  const revoked = row.revokedAt !== null;

  const referred = row.referredByLine.reduce((total, line) => total + line.count, 0);
  const byLine = row.referredByLine.map((line) => `${line.line}: ${line.count}`).join(' · ');

  return (
    <>
      <tr>
        <td>
          <div className="cell">
            <Link href={`/clients/${id}`} className="who__link">
              {row.title}
            </Link>
            <span className="cell__note">
              {row.username ? `@${row.username} · ${id}` : id}
              {revoked ? ' · снят' : ''}
            </span>
          </div>
        </td>
        <td>
          {row.signedInAt ? (
            <Moment at={row.signedInAt.toISOString()} mode="day" />
          ) : (
            <span className="muted">не входил</span>
          )}
        </td>
        <td className="num" title={byLine}>
          {referred}
        </td>
        <td className="num">{formatAmount(row.accrued)}</td>
        <td>
          <div className="cell">
            <span>{row.createdByName}</span>
            <span className="cell__note">
              <Moment at={row.createdAt.toISOString()} mode="day" />
            </span>
          </div>
        </td>
        <td className="num">
          {revoked ? (
            <button
              type="button"
              className="btn btn--ghost btn--tiny"
              disabled={busy}
              onClick={() => act({ action: 'restore', telegramUserId: id })}
            >
              Вернуть
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--tiny"
              disabled={busy}
              onClick={() => setConfirming((was) => !was)}
            >
              Снять
            </button>
          )}
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={6}>
            <p className="error">{error}</p>
          </td>
        </tr>
      ) : undefined}
      {confirming ? (
        <tr>
          <td colSpan={6}>
            <div className="confirm">
              <p className="card__note">
                {row.title} перестанет входить в кабинет сразу же. Начисленное останется при нём,
                приведённые — тоже; вернуть отметку можно той же кнопкой.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={busy}
                  onClick={async () => {
                    if (await act({ action: 'revoke', telegramUserId: id })) {
                      setConfirming(false);
                    }
                  }}
                >
                  Снять отметку
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Оставить
                </button>
              </div>
            </div>
          </td>
        </tr>
      ) : undefined}
    </>
  );
}
