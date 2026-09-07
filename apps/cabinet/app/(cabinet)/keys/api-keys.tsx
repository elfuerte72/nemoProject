'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CopyValue, EmptyState, Moment } from '@nemo/ui';
import type { KeyRow } from '@/lib/key-rows';
import { send } from '@/app/ui/send';

/**
 * Ключи: список, выпуск, отзыв.
 *
 * Выпущенный ключ показывается тут же, в карточке с предупреждением, и
 * пропадает с первой же перерисовкой страницы: второго показа нет.
 * Отзыв спрашивает подтверждение раскрытием строки — необратимое, и
 * кнопка при этом не гаснет: погашенная теряет фокус.
 */
export function ApiKeys({
  keys,
  canIssue,
}: {
  readonly keys: readonly KeyRow[];
  /** Ложь у отключённого: выпуск отказал бы, а отзыв — нет. */
  readonly canIssue: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [issued, setIssued] = useState<{ hint: string; label: string; secret: string }>();
  const [revoking, setRevoking] = useState<string>();

  async function issue(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setComplaint(undefined);

    const result = await send('/api/keys', { label });
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    const data = result.data as { key: KeyRow; secret: string };
    setIssued({ hint: data.key.hint, label: data.key.label, secret: data.secret });
    setLabel('');
    router.refresh();
  }

  async function revoke(id: string) {
    setBusy(true);
    setComplaint(undefined);

    const result = await send(`/api/keys/${id}/revoke`, {});
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    setRevoking(undefined);
    router.refresh();
  }

  return (
    <section className="card">
      <h2 className="card__title">Ключи</h2>

      {issued ? (
        <div className="secret" role="status">
          <p className="secret__title">
            Ключ «{issued.label}» выпущен. Скопируйте его сейчас — второй раз он не покажется.
          </p>
          <CopyValue value={issued.secret} />
          <p className="secret__note">
            В списке он будет виден как {issued.hint}. Сохраните ключ там, где храните
            остальные секреты, и не кладите его в код и в письма.
          </p>
        </div>
      ) : undefined}

      {complaint ? <p className="error">{complaint}</p> : undefined}

      {keys.length === 0 ? (
        <EmptyState
          icon="key"
          title="Ключей пока нет"
          text="Выпустите первый — с подписью, для чего он: «сайт», «бухгалтерия»."
        />
      ) : (
        <ul className="table table--keys">
          <li className="table__head" aria-hidden>
            <span>Подпись</span>
            <span>Ключ</span>
            <span>Выпущен</span>
            <span>Последний вызов</span>
            <span>Состояние</span>
            <span />
          </li>
          {keys.map((key) => (
            <li key={key.id} className="table__item">
              <div className="table__row">
                <span className="cell">
                  <span className="cell__label">Подпись</span>
                  <span className="cell__value">{key.label}</span>
                </span>
                <span className="cell">
                  <span className="cell__label">Ключ</span>
                  <span className="cell__value mono">{key.hint}</span>
                </span>
                <span className="cell">
                  <span className="cell__label">Выпущен</span>
                  <span className="cell__value">
                    <Moment at={key.issuedAt} mode="day" />
                  </span>
                </span>
                <span className="cell">
                  <span className="cell__label">Последний вызов</span>
                  <span className="cell__value">
                    {key.lastUsedAt ? <Moment at={key.lastUsedAt} /> : <span className="muted">не было</span>}
                  </span>
                </span>
                <span className="cell">
                  <span className="cell__label">Состояние</span>
                  {key.revokedAt ? (
                    <span className="pill pill--off">Отозван</span>
                  ) : (
                    <span className="pill pill--done">Действует</span>
                  )}
                </span>
                <span className="cell cell--actions">
                  {key.revokedAt ? undefined : revoking === key.id ? (
                    <span className="row__actions">
                      <button
                        type="button"
                        className="btn btn--danger btn--tiny"
                        onClick={() => void revoke(key.id)}
                        aria-busy={busy}
                      >
                        Да, отозвать
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--tiny"
                        onClick={() => setRevoking(undefined)}
                      >
                        Оставить
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost btn--tiny"
                      onClick={() => setRevoking(key.id)}
                    >
                      Отозвать
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canIssue ? (
        <form className="form-row form-row--issue" onSubmit={issue}>
          <label className="field">
            <span className="label">Подпись нового ключа</span>
            <input
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="сайт"
              maxLength={60}
              required
            />
          </label>
          <div className="row__actions">
            <button type="submit" className="btn btn--gold" disabled={busy}>
              {busy ? 'Выпускаем…' : 'Выпустить ключ'}
            </button>
          </div>
        </form>
      ) : (
        <p className="card__note">Доступ отключён: новые ключи не выпускаются, отозвать можно.</p>
      )}
    </section>
  );
}
