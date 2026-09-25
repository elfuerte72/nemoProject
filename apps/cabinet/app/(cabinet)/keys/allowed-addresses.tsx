'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { EmptyState, Moment } from '@nemo/ui';
import type { AddressRow } from '@/lib/address-rows';
import { plural } from '@/lib/plural';
import { send } from '@/app/ui/send';

/** Адрес, с которого звали за сутки, и покрыт ли он списком. */
export interface CallerRow {
  readonly address: string;
  readonly calls: number;
  /** Сколько вызовов пропущено на входе: у адреса, который не пропускали, «Разрешить» нет. */
  readonly admitted: number;
  readonly lastAt: string;
  readonly listed: boolean;
}

/**
 * «Разрешённые адреса»: с каких машин принимаются вызовы API.
 *
 * Рядом со списком — адреса, с которых звали за сутки: адрес своего
 * сервера по памяти вписывают с ошибкой, и интеграция встаёт. Отсюда он
 * добавляется одним нажатием, а чужой в том же списке виден сразу.
 *
 * Первый адрес меняет правило целиком — с него вызовы с прочих
 * отвергаются, — и об этом сказано до нажатия, а не после 403.
 */
export function AllowedAddresses({
  addresses,
  callers,
}: {
  readonly addresses: readonly AddressRow[];
  readonly callers: readonly CallerRow[];
}) {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [removing, setRemoving] = useState<string>();

  async function add(value: string, withNote: string) {
    if (busy) return false;
    setBusy(true);
    setComplaint(undefined);
    const result = await send('/api/addresses', { address: value, note: withNote });
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return false;
    }
    router.refresh();
    return true;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await add(address, note)) {
      setAddress('');
      setNote('');
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setComplaint(undefined);
    const result = await send(`/api/addresses/${id}/remove`, {});
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    setRemoving(undefined);
    router.refresh();
  }

  const unlisted = callers.filter((one) => !one.listed);

  return (
    <section className="card" id="addresses">
      <h2 className="card__title">Разрешённые адреса</h2>
      <p className="card__note">
        {addresses.length === 0
          ? 'Список пуст — вызовы принимаются с любого адреса. С первым же адресом в списке ' +
            'вызовы с остальных начнут получать 403 address_not_allowed.'
          : 'Вызовы принимаются только с этих адресов. С прочих — 403 address_not_allowed, и ' +
            'такой вызов виден в журнале вызовов вместе с адресом.'}
      </p>

      {complaint ? <p className="error">{complaint}</p> : undefined}

      {addresses.length === 0 ? (
        <EmptyState
          icon="plug"
          title="Адресов нет"
          text="Добавьте адреса серверов, с которых ваша система зовёт API: с ними украденный ключ бесполезен вне ваших серверов."
        />
      ) : (
        <ul className="table table--addresses">
          <li className="table__head" aria-hidden>
            <span>Адрес или подсеть</span>
            <span>Назначение</span>
            <span>Добавлен</span>
            <span />
          </li>
          {addresses.map((row) => (
            <li key={row.id} className="table__item">
              <div className="table__row">
                <span className="cell">
                  <span className="cell__label">Адрес или подсеть</span>
                  <span className="cell__value mono">{row.address}</span>
                </span>
                <span className="cell">
                  <span className="cell__label">Назначение</span>
                  <span className="cell__value">{row.note ?? <span className="muted">—</span>}</span>
                </span>
                <span className="cell">
                  <span className="cell__label">Добавлен</span>
                  <span className="cell__value">
                    <Moment at={row.createdAt} />
                  </span>
                </span>
                <span className="cell cell--actions">
                  {removing === row.id ? (
                    <span className="row__actions">
                      <button
                        type="button"
                        className="btn btn--danger btn--tiny"
                        onClick={() => void remove(row.id)}
                        aria-busy={busy}
                      >
                        {addresses.length === 1 ? 'Да, пускать с любого' : 'Да, убрать'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--tiny"
                        onClick={() => setRemoving(undefined)}
                      >
                        Оставить
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost btn--tiny"
                      onClick={() => setRemoving(row.id)}
                    >
                      Убрать
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="form-row form-row--address" onSubmit={submit}>
        <label className="field">
          <span className="label">Адрес или подсеть</span>
          <input
            className="input mono"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="203.0.113.7 или 203.0.113.0/24"
            maxLength={60}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span className="label">Назначение</span>
          <input
            className="input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="сервер сайта"
            maxLength={60}
          />
        </label>
        <div className="row__actions">
          <button type="submit" className="btn btn--gold" disabled={busy}>
            {busy ? 'Добавляем…' : 'Добавить адрес'}
          </button>
        </div>
      </form>

      {callers.length > 0 ? (
        <div className="callers">
          <h3 className="callers__title">Откуда звали за сутки</h3>
          <ul className="callers__list">
            {callers.map((caller) => (
              <li key={caller.address} className="callers__item">
                <span className="mono">{caller.address}</span>
                <span className="muted">
                  {caller.calls} {plural(caller.calls, 'вызов', 'вызова', 'вызовов')} · последний <Moment at={caller.lastAt} />
                </span>
                {caller.listed ? (
                  <span className="pill pill--done">в списке</span>
                ) : caller.admitted === 0 ? (
                  /*
                   * Адрес не пропустили на входе ни разу — ключ, подпись
                   * или адрес не прошли. Это тот, кого не пустили, а не ваш
                   * сервер; кнопки у него нет: вор с утёкшим ключом стоит в
                   * этом же списке.
                   */
                  <span className="pill pill--off">только отказы</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--tiny"
                    onClick={() => void add(caller.address, '')}
                    aria-busy={busy}
                  >
                    Разрешить
                  </button>
                )}
              </li>
            ))}
          </ul>
          {addresses.length > 0 && unlisted.length > 0 ? (
            <p className="card__note">
              Вызовы с адресов не из списка отвергаются. Если это ваш сервер — разрешите его.
              «Только отказы» — адрес, который ни разу не прошёл ключ, подпись или список
              адресов: если вы его не знаете, ключ стоит отозвать и выпустить новый.
            </p>
          ) : undefined}
        </div>
      ) : undefined}
    </section>
  );
}
