'use client';

import { useState } from 'react';
import type { StaffView } from '@nemo/core';
import type { StaffRole } from '@nemo/types';
import { pillClass, ROLE_LABELS } from '@/lib/labels';
import { useSettingsSend } from './use-settings-send';

/**
 * Сотрудники: кто заведён, с какой ролью и с каким доступом.
 *
 * Второй фактор сотруднику выдаёт администратор — вход его не создаёт.
 * Ключ показывается один раз здесь, но передавать его из рук в руки не
 * обязательно: пока этим ключом ни разу не входили, сотрудник увидит
 * тот же код на своём первом входе.
 */
export type StaffForDisplay = Omit<StaffView, 'telegramUserId'> & { telegramUserId: string };

export function StaffForm({ staff }: { staff: readonly StaffForDisplay[] }) {
  const { error, busy, send } = useSettingsSend();
  const [secret, setSecret] = useState<{
    name: string;
    value: string;
    qr?: string | undefined;
  }>();

  const [newTelegram, setNewTelegram] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('manager');

  async function enroll(body: unknown, name: string) {
    const result = await send('/api/staff', body);
    if (result?.enrollmentSecret) {
      setSecret({ name, value: result.enrollmentSecret, qr: result.qr });
    }
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : undefined}

      {secret ? (
        <section className="card secret">
          <h2 className="card__title">Второй фактор для «{secret.name}»</h2>
          <p className="card__note">
            Наведите камеру приложения-аутентификатора — Google Authenticator, Яндекс
            Ключ, 1Password. Здесь ключ показывается один раз, но передавать его из рук
            в руки не обязательно: пока этим ключом ни разу не входили, сотрудник
            увидит тот же код на своём первом входе. Запись в приложении подписана
            Telegram сотрудника и его ролью.
          </p>
          {secret.qr ? (
            // Разметка кода приходит с сервера и содержит только фигуры,
            // собранные из ключа, — ни ввода пользователя, ни ссылок.
            <div className="secret__qr" dangerouslySetInnerHTML={{ __html: secret.qr }} />
          ) : undefined}
          <div className="field">
            <span className="label">Если камеры нет — ключ вручную</span>
            <code className="secret__key mono">{secret.value}</code>
          </div>
          <div className="row__actions">
            <button type="button" onClick={() => setSecret(undefined)} className="btn btn--soft">
              Готово, скрыть
            </button>
          </div>
        </section>
      ) : undefined}

      <section className="card">
        <h2 className="card__title">Завести сотрудника</h2>
        <p className="card__note">
          Telegram ID — число из профиля, а не ник: ник меняется, а вход подписывает
          число. Ключ второго фактора появится сразу после заведения.
        </p>
        <div className="form-row">
          <label className="field field--narrow">
            <span className="label">Telegram ID</span>
            <input
              className="input"
              value={newTelegram}
              onChange={(event) => setNewTelegram(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span className="label">Имя</span>
            <input
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <label className="field field--narrow">
            <span className="label">Роль</span>
            <select
              className="input"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as StaffRole)}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !newTelegram.trim() || !newName.trim()}
            className="btn btn--gold"
            onClick={() =>
              void enroll(
                {
                  action: 'add',
                  telegramUserId: newTelegram.trim(),
                  displayName: newName.trim(),
                  role: newRole,
                },
                newName.trim(),
              )
            }
          >
            Завести
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Сотрудники</h2>
        <ul className="rows">
          {staff.map((one) => (
            <li key={one.id} className="row row--stack">
              <div className="row__side" style={{ justifyContent: 'space-between' }}>
                <div className="row__main">
                  <span className="row__title">{one.displayName}</span>
                  <span className="row__meta">
                    {ROLE_LABELS[one.role]} · {one.telegramUserId}
                  </span>
                </div>
                <div className="row__side">
                  {one.isActive ? undefined : <span className={pillClass('off')}>Доступ закрыт</span>}
                  {one.hasSecondFactor ? undefined : (
                    <span className={pillClass('wait')}>Без второго фактора</span>
                  )}
                  {/*
                    Ключ выдан, но сотрудник им ещё не входил — значит,
                    вход покажет ему этот ключ сам. Администратору это
                    видно здесь: иначе он не поймёт, отчего один
                    сотрудник видит на входе код для камеры, а другой нет.
                  */}
                  {one.hasSecondFactor && !one.secondFactorConfirmed ? (
                    <span className={pillClass('wait')}>Ключ не занесён</span>
                  ) : undefined}
                </div>
              </div>
              <div className="row__actions">
                <button
                  type="button"
                  disabled={busy}
                  className="btn btn--ghost"
                  onClick={() =>
                    send('/api/staff', {
                      action: 'role',
                      staffId: one.id,
                      role: one.role === 'admin' ? 'manager' : 'admin',
                    })
                  }
                >
                  {one.role === 'admin' ? 'Сделать менеджером' : 'Сделать администратором'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={one.isActive ? 'btn btn--danger' : 'btn btn--ghost'}
                  onClick={() =>
                    send('/api/staff', {
                      action: 'access',
                      staffId: one.id,
                      isActive: !one.isActive,
                    })
                  }
                >
                  {one.isActive ? 'Отключить' : 'Вернуть доступ'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn btn--ghost"
                  onClick={() =>
                    void enroll({ action: 'reset-second-factor', staffId: one.id }, one.displayName)
                  }
                >
                  Выдать второй фактор заново
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
