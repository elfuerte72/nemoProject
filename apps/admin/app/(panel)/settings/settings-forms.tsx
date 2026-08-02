'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CurrencyPairAdminView, ServiceSettingsView, StaffView } from '@nemo/core';
import type { StaffRole } from '@nemo/types';
import { KIND_LABELS } from '@/lib/exchange-request-labels';
import { pillClass, ROLE_LABELS } from '@/lib/labels';

/**
 * Раздел администратора: экономика сервиса и сотрудники.
 *
 * Смена ставок действует вперёд: уже сделанные начисления не
 * пересчитываются, потому что ставка, по которой начислено, хранится в
 * самом движении баллов. Экран говорит об этом прямо — иначе
 * администратор ждал бы пересчёта и не понимал, почему его нет.
 */

type StaffForDisplay = Omit<StaffView, 'telegramUserId'> & { telegramUserId: string };

export function SettingsForms({
  settings,
  pairs,
  staff,
}: {
  settings: ServiceSettingsView;
  pairs: readonly CurrencyPairAdminView[];
  staff: readonly StaffForDisplay[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{
    name: string;
    value: string;
    qr?: string | undefined;
  }>();

  const [line1, setLine1] = useState(String(settings.referralLine1Bps));
  const [line2, setLine2] = useState(String(settings.referralLine2Bps));
  const [minWithdrawal, setMinWithdrawal] = useState<string>(settings.minWithdrawalAmount);
  const [markups, setMarkups] = useState<Record<string, string>>(
    Object.fromEntries(pairs.map((pair) => [pair.id, String(pair.markupBps)])),
  );

  const [newTelegram, setNewTelegram] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('manager');

  async function send(
    path: string,
    body: unknown,
  ): Promise<{ enrollmentSecret?: string; qr?: string; staff?: StaffView } | undefined> {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: string;
        enrollmentSecret?: string;
        qr?: string;
        staff?: StaffView;
      };
      if (!response.ok) {
        setError(payload.error ?? 'Настройка не сохранена');
        return undefined;
      }
      router.refresh();
      return payload;
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

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
            Ключ, 1Password. Показывается один раз: закроете — придётся выдавать заново.
            Запись в приложении подписана Telegram сотрудника и его ролью.
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
        <h2 className="card__title">Ставки линий и вывод</h2>
        <p className="card__note">
          Ставка задаётся в базисных пунктах: 100 bps = 1%. Уже сделанные начисления от
          смены ставки не меняются — заявка исполнена на тех условиях, что действовали в
          момент её исполнения.
        </p>
        <div className="form-row">
          <label className="field">
            <span className="label">Первая линия, bps</span>
            <input
              className="input"
              value={line1}
              onChange={(event) => setLine1(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span className="label">Вторая линия, bps</span>
            <input
              className="input"
              value={line2}
              onChange={(event) => setLine2(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span className="label">Минимум на вывод, баллов</span>
            <input
              className="input"
              value={minWithdrawal}
              onChange={(event) => setMinWithdrawal(event.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="row__actions">
          <button
            type="button"
            disabled={busy}
            className="btn btn--gold"
            onClick={() =>
              send('/api/settings', {
                subject: 'service',
                referralLine1Bps: Number(line1),
                referralLine2Bps: Number(line2),
                minWithdrawalAmount: minWithdrawal.replace(',', '.').trim(),
              })
            }
          >
            Сохранить
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Наценки по направлениям</h2>
        {pairs.length === 0 ? (
          <p className="empty">
            Направления обмена ещё не заведены — наполнение справочника ждёт ответа
            заказчика о списке валют.
          </p>
        ) : (
          <ul className="rows">
            {pairs.map((pair) => (
              <li key={pair.id} className="row">
                <div className="row__main">
                  <span className="row__title">
                    {pair.fromCode} → {pair.toCode}
                  </span>
                  <span className="row__meta">{KIND_LABELS[pair.kind]}</span>
                </div>
                <div className="row__side">
                  <input
                    className="input"
                    style={{ width: '7rem' }}
                    value={markups[pair.id] ?? ''}
                    onChange={(event) =>
                      setMarkups((current) => ({ ...current, [pair.id]: event.target.value }))
                    }
                    inputMode="numeric"
                    aria-label={`Наценка ${pair.fromCode} → ${pair.toCode}, bps`}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="btn btn--ghost"
                    onClick={() =>
                      send('/api/settings', {
                        subject: 'currency-pair',
                        pairId: pair.id,
                        markupBps: Number(markups[pair.id]),
                      })
                    }
                  >
                    Сохранить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Сотрудники</h2>
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
            disabled={busy}
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
