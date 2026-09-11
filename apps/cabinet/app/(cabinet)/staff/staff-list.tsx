'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { EmptyState, Moment } from '@nemo/ui';
import { merchantRoleName, type MerchantUserRole } from '@nemo/types';
import { ROLE_HINTS } from '@/lib/staff-texts';
import { send } from '@/app/ui/send';

/**
 * Люди кабинета: список, добавление, роль, пароль, доступ.
 *
 * Строка владельца — без кнопок: роль ему не меняется, доступ не
 * закрывается, а пароль он меняет себе в настройках, где спрашивают
 * нынешний. Ядро отвечает то же самое, и кнопки здесь нет не вместо
 * правила, а потому, что нажимать её было бы не за чем.
 *
 * Закрытие доступа и новый пароль спрашивают подтверждения раскрытием
 * строки: первое выбрасывает человека из кабинета на полуслове, второе
 * обрывает его сессии. Кнопка при этом не гаснет — погашенная теряет
 * фокус, и работающий с клавиатуры оказывается в начале страницы.
 */

export interface StaffRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: MerchantUserRole;
  /** Строкой, а не `Date`: через границу сервера едет разметка, не объекты. */
  readonly disabledAt: string | null;
  readonly createdAt: string;
}

const ROLES: readonly MerchantUserRole[] = ['operator', 'viewer'];

export function StaffList({
  people,
  meId,
}: {
  readonly people: readonly StaffRow[];
  /** Кто смотрит: себе владелец роль и доступ не меняет. */
  readonly meId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    role: 'operator' as MerchantUserRole,
  });
  const [closing, setClosing] = useState<string>();
  const [repassword, setRepassword] = useState<{ id: string; value: string }>();

  async function act(path: string, body: unknown, after?: () => void): Promise<void> {
    setBusy(true);
    setComplaint(undefined);

    const result = await send(path, body);
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    after?.();
    router.refresh();
  }

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault();
    await act('/api/staff', form, () => {
      setForm({ email: '', password: '', name: '', role: 'operator' });
      setAdding(false);
    });
  }

  return (
    <section className="card">
      <h2 className="card__title">Кто входит</h2>

      {complaint ? <p className="error">{complaint}</p> : undefined}

      {people.length === 0 ? (
        <EmptyState
          icon="user"
          title="В кабинете только вы"
          text="Заведите оператора, если заявки подаёт кто-то ещё, или наблюдателя — для чисел."
        />
      ) : (
        <ul className="table table--staff">
          <li className="table__head" aria-hidden>
            <span>Имя</span>
            <span>Почта</span>
            <span>Роль</span>
            <span>Заведён</span>
            <span>Доступ</span>
            <span />
          </li>
          {people.map((one) => {
            const isOwner = one.role === 'owner';
            const isMe = one.id === meId;
            return (
              <li key={one.id} className="table__item">
                <div className="table__row">
                  <span className="cell">
                    <span className="cell__label">Имя</span>
                    <span className="cell__value">
                      {one.name}
                      {isMe ? <span className="muted"> · это вы</span> : undefined}
                    </span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Почта</span>
                    <span className="cell__value break">{one.email}</span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Роль</span>
                    {isOwner ? (
                      <span className="cell__value">{merchantRoleName(one.role)}</span>
                    ) : (
                      <select
                        className="input input--tiny"
                        value={one.role}
                        aria-label={`Роль: ${one.name}`}
                        disabled={busy}
                        onChange={(event) =>
                          void act(`/api/staff/${one.id}`, { role: event.target.value })
                        }
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {merchantRoleName(role)}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                  <span className="cell">
                    <span className="cell__label">Заведён</span>
                    <span className="cell__value">
                      <Moment at={one.createdAt} mode="day" />
                    </span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Доступ</span>
                    {one.disabledAt ? (
                      <span className="pill pill--off">Закрыт</span>
                    ) : (
                      <span className="pill pill--done">Открыт</span>
                    )}
                  </span>
                  <span className="cell cell--actions">
                    {isOwner ? (
                      <span className="muted">Пароль — в настройках</span>
                    ) : closing === one.id ? (
                      <span className="row__actions">
                        <button
                          type="button"
                          className="btn btn--danger btn--tiny"
                          aria-busy={busy}
                          onClick={() =>
                            void act(`/api/staff/${one.id}/access`, { allowed: false }, () =>
                              setClosing(undefined),
                            )
                          }
                        >
                          Да, закрыть
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--tiny"
                          onClick={() => setClosing(undefined)}
                        >
                          Оставить
                        </button>
                      </span>
                    ) : repassword?.id === one.id ? (
                      <span className="row__actions">
                        <input
                          className="input input--tiny"
                          type="password"
                          value={repassword.value}
                          placeholder="Новый пароль"
                          aria-label={`Новый пароль: ${one.name}`}
                          onChange={(event) =>
                            setRepassword({ id: one.id, value: event.target.value })
                          }
                        />
                        <button
                          type="button"
                          className="btn btn--tiny"
                          aria-busy={busy}
                          onClick={() =>
                            void act(
                              `/api/staff/${one.id}/password`,
                              { password: repassword.value },
                              () => setRepassword(undefined),
                            )
                          }
                        >
                          Задать
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--tiny"
                          onClick={() => setRepassword(undefined)}
                        >
                          Отмена
                        </button>
                      </span>
                    ) : (
                      <span className="row__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--tiny"
                          onClick={() => setRepassword({ id: one.id, value: '' })}
                        >
                          Новый пароль
                        </button>
                        {one.disabledAt ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--tiny"
                            aria-busy={busy}
                            onClick={() =>
                              void act(`/api/staff/${one.id}/access`, { allowed: true })
                            }
                          >
                            Открыть доступ
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--ghost btn--tiny"
                            onClick={() => setClosing(one.id)}
                          >
                            Закрыть доступ
                          </button>
                        )}
                      </span>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <form className="form form--staff" onSubmit={add}>
          <label className="field">
            <span className="label">Имя</span>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Анна"
              required
            />
            <span className="hint">По нему его узнают в списке заявок.</span>
          </label>
          <label className="field">
            <span className="label">Почта</span>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="anna@example.com"
              required
            />
            <span className="hint">Ею он входит, и на неё уходит сброс пароля.</span>
          </label>
          <label className="field">
            <span className="label">Пароль</span>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />
            <span className="hint">Придумайте и передайте лично: письма с паролем мы не шлём.</span>
          </label>
          <label className="field">
            <span className="label">Роль</span>
            <select
              className="input"
              value={form.role}
              onChange={(event) =>
                setForm({ ...form, role: event.target.value as MerchantUserRole })
              }
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {merchantRoleName(role)}
                </option>
              ))}
            </select>
            <span className="hint">{ROLE_HINTS[form.role]}</span>
          </label>
          <div className="form__actions">
            <button type="submit" className="btn" aria-busy={busy}>
              Завести
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setAdding(false);
                setComplaint(undefined);
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          Завести сотрудника
        </button>
      )}
    </section>
  );
}
