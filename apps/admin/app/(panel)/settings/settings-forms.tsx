'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  NetworkView,
  ServiceSettingsView,
  StaffView,
  TextTemplateView,
} from '@nemo/core';
import type { StaffRole } from '@nemo/types';
import { pillClass, ROLE_LABELS } from '@/lib/labels';

/**
 * Раздел администратора: экономика сервиса и сотрудники.
 *
 * Смена ставок действует вперёд: уже сделанные начисления не
 * пересчитываются, потому что ставка, по которой начислено, хранится в
 * самом движении баллов. Экран говорит об этом прямо — иначе
 * администратор ждал бы пересчёта и не понимал, почему его нет.
 *
 * Экономика собрана в одну карточку: наценка, минимум обмена и срок
 * жизни заявки складываются в доход сервиса, и разнесённые по разным
 * местам они не читались бы вместе.
 */

type StaffForDisplay = Omit<StaffView, 'telegramUserId'> & { telegramUserId: string };

export function SettingsForms({
  settings,
  networks,
  templates,
  staff,
}: {
  settings: ServiceSettingsView;
  networks: readonly NetworkView[];
  templates: readonly TextTemplateView[];
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
  const [markup, setMarkup] = useState(String(settings.markupBps));
  const [minExchange, setMinExchange] = useState<string>(settings.minExchangeAmount);
  const [ttlMinutes, setTtlMinutes] = useState(String(settings.unpaidExchangeRequestTtlMinutes));

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
        <h2 className="card__title">Экономика обмена</h2>
        <p className="card__note">
          Наценка одна на весь сервис и действует в обе стороны. Минимальная сумма
          задана в рублях: при наценке в пару процентов мелкий обмен не покрывает
          комиссию сети, которую сервис платит за клиента. Срок отсчитывается с
          момента, когда менеджер выдал реквизиты для оплаты.
        </p>
        <div className="form-row">
          <label className="field">
            <span className="label">Наценка, bps</span>
            <input
              className="input"
              value={markup}
              onChange={(event) => setMarkup(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span className="label">Минимум обмена, ₽</span>
            <input
              className="input"
              value={minExchange}
              onChange={(event) => setMinExchange(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span className="label">Срок оплаты, минут</span>
            <input
              className="input"
              value={ttlMinutes}
              onChange={(event) => setTtlMinutes(event.target.value)}
              inputMode="numeric"
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
                markupBps: Number(markup),
                minExchangeAmount: minExchange.replace(',', '.').trim(),
                unpaidExchangeRequestTtlMinutes: Number(ttlMinutes),
              })
            }
          >
            Сохранить
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Сети перевода</h2>
        <p className="card__note">
          Один справочник на реквизиты обмена и на выплаты: выключенная сеть перестаёт
          предлагаться и там и там. Выключайте её, пока кошелёк недоступен, — сохранённые
          клиентами адреса в ней при этом не пропадают.
        </p>
        {networks.length === 0 ? (
          <p className="empty">Сети ещё не заведены: их создаёт скрипт развёртывания.</p>
        ) : (
          <ul className="rows">
            {networks.map((network) => (
              <li key={network.code} className="row">
                <div className="row__main">
                  <span className="row__title">{network.code}</span>
                  <span className="row__meta">
                    {network.isActive ? 'Предлагается клиентам' : 'Выключена'}
                  </span>
                </div>
                <div className="row__actions">
                  <button
                    type="button"
                    disabled={busy}
                    className={network.isActive ? 'btn btn--danger' : 'btn btn--ghost'}
                    onClick={() =>
                      send('/api/networks', {
                        code: network.code,
                        isActive: !network.isActive,
                      })
                    }
                  >
                    {network.isActive ? 'Выключить' : 'Включить'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TextTemplates templates={templates} busy={busy} onSave={send} />

      <section className="card" id="staff">
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

/**
 * Заготовки текстов.
 *
 * Реквизиты сервиса для оплаты и тексты, которые читает клиент. Правятся
 * без выкатки — это и есть их смысл, — и потому не проходят ревью:
 * плата принята сознательно, а значения по умолчанию остаются в коде.
 *
 * Каждая заготовка сохраняется отдельно: одна кнопка на все означала бы,
 * что правка одного текста трогает журнал по остальным.
 */
function TextTemplates({
  templates,
  busy,
  onSave,
}: {
  templates: readonly TextTemplateView[];
  busy: boolean;
  onSave: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(templates.map((one) => [one.key, one.body])),
  );

  return (
    <section className="card">
      <h2 className="card__title">Заготовки текстов</h2>
      <p className="card__note">
        Менеджер вставляет их в заявку одной кнопкой, а не набирает номер руками. Пока
        заготовку не правили, показывается значение из кода — оно ничего не обещает
        клиенту и служит образцом тона.
      </p>
      {templates.map((template) => (
        <div key={template.key} className="field">
          <span className="label">
            {template.title}
            {template.isDefault ? ' · значение из кода' : ''}
          </span>
          <textarea
            className="input"
            rows={3}
            value={drafts[template.key] ?? template.body}
            onChange={(event) =>
              setDrafts((current) => ({ ...current, [template.key]: event.target.value }))
            }
          />
          <div className="row__actions">
            <button
              type="button"
              disabled={busy || !(drafts[template.key] ?? template.body).trim()}
              className="btn btn--soft"
              onClick={() =>
                onSave('/api/text-templates', {
                  key: template.key,
                  body: drafts[template.key] ?? template.body,
                })
              }
            >
              Сохранить
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
