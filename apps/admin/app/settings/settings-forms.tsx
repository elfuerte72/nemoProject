'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  CurrencyPairAdminView,
  ServiceSettingsView,
  StaffEnrollment,
  StaffView,
} from '@nemo/core';
import type { StaffRole } from '@nemo/types';
import { KIND_LABELS } from '@/lib/exchange-request-labels';
import { ROLE_LABELS } from '@/lib/labels';

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
  const [secret, setSecret] = useState<{ name: string; value: string }>();

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
  ): Promise<{ enrollmentSecret?: string; staff?: StaffView } | undefined> {
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
    const result = (await send('/api/staff', body)) as StaffEnrollment | undefined;
    if (result?.enrollmentSecret) {
      setSecret({ name, value: result.enrollmentSecret });
    }
  }

  return (
    <div style={styles.page}>
      {error ? <p style={styles.error}>{error}</p> : undefined}

      {secret ? (
        <section style={styles.secretBox}>
          <p>
            Второй фактор для «{secret.name}». Передайте его сотруднику лично — второй раз
            он показан не будет:
          </p>
          <code style={styles.secret}>{secret.value}</code>
          <button type="button" onClick={() => setSecret(undefined)} style={styles.link}>
            Я передал, скрыть
          </button>
        </section>
      ) : undefined}

      <section style={styles.block}>
        <h2 style={styles.heading}>Ставки линий и вывод</h2>
        <p style={styles.muted}>
          Ставка задаётся в базисных пунктах: 100 bps = 1%. Уже сделанные начисления от
          смены ставки не меняются — сделка закрыта на тех условиях, что действовали в
          момент её исполнения.
        </p>
        <label style={styles.field}>
          <span style={styles.label}>Первая линия, bps</span>
          <input
            value={line1}
            onChange={(event) => setLine1(event.target.value)}
            inputMode="numeric"
            style={styles.input}
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Вторая линия, bps</span>
          <input
            value={line2}
            onChange={(event) => setLine2(event.target.value)}
            inputMode="numeric"
            style={styles.input}
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Минимальная сумма вывода, баллов</span>
          <input
            value={minWithdrawal}
            onChange={(event) => setMinWithdrawal(event.target.value)}
            inputMode="decimal"
            style={styles.input}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          style={styles.button}
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
      </section>

      <section style={styles.block}>
        <h2 style={styles.heading}>Наценки по направлениям</h2>
        {pairs.length === 0 ? (
          <p style={styles.muted}>
            Направления обмена ещё не заведены — наполнение справочника ждёт ответа
            заказчика о списке валют.
          </p>
        ) : (
          <ul style={styles.list}>
            {pairs.map((pair) => (
              <li key={pair.id} style={styles.row}>
                <span style={styles.pair}>
                  {pair.fromCode} → {pair.toCode} · {KIND_LABELS[pair.kind]}
                </span>
                <input
                  value={markups[pair.id] ?? ''}
                  onChange={(event) =>
                    setMarkups((current) => ({ ...current, [pair.id]: event.target.value }))
                  }
                  inputMode="numeric"
                  style={styles.narrow}
                />
                <button
                  type="button"
                  disabled={busy}
                  style={styles.button}
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={styles.block}>
        <h2 style={styles.heading}>Сотрудники</h2>
        <div style={styles.row}>
          <input
            value={newTelegram}
            onChange={(event) => setNewTelegram(event.target.value)}
            placeholder="Telegram ID"
            inputMode="numeric"
            style={styles.narrow}
          />
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Имя"
            style={styles.input}
          />
          <select
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as StaffRole)}
            style={styles.narrow}
          >
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            style={styles.button}
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

        <ul style={styles.list}>
          {staff.map((one) => (
            <li key={one.id} style={styles.row}>
              <span style={styles.pair}>
                {one.displayName} · {ROLE_LABELS[one.role]} · {one.telegramUserId}
                {one.isActive ? '' : ' · доступ закрыт'}
                {one.hasSecondFactor ? '' : ' · без второго фактора'}
              </span>
              <button
                type="button"
                disabled={busy}
                style={styles.smallButton}
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
                style={styles.smallButton}
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
                style={styles.smallButton}
                onClick={() =>
                  void enroll(
                    { action: 'reset-second-factor', staffId: one.id },
                    one.displayName,
                  )
                }
              >
                Выдать второй фактор заново
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: '2rem' },
  block: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  heading: { fontSize: '1.05rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  label: { fontSize: '0.8rem', opacity: 0.7 },
  input: { flex: 1, minWidth: '8rem', padding: '0.5rem', fontSize: '0.95rem' },
  narrow: { width: '9rem', padding: '0.5rem', fontSize: '0.95rem' },
  button: { padding: '0.55rem 0.9rem', fontSize: '0.95rem' },
  smallButton: { padding: '0.35rem 0.6rem', fontSize: '0.8rem' },
  row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  pair: { flex: 1, minWidth: '14rem', fontSize: '0.95rem' },
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  secretBox: {
    border: '1px solid currentColor',
    padding: '0.9rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    fontSize: '0.9rem',
  },
  secret: { fontSize: '1rem', wordBreak: 'break-all', userSelect: 'all' },
  link: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: '0.85rem',
    textDecoration: 'underline',
    cursor: 'pointer',
    color: 'inherit',
    alignSelf: 'flex-start',
  },
  muted: { opacity: 0.7, fontSize: '0.85rem', lineHeight: 1.45 },
  error: { color: '#c0392b', fontSize: '0.9rem' },
} satisfies Record<string, React.CSSProperties>;
