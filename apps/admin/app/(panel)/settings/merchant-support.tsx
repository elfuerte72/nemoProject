'use client';

import { useState } from 'react';
import type { ServiceSettingsView } from '@nemo/core';
import { useSettingsSend } from './use-settings-send';

/**
 * Куда мерчанты пишут за помощью.
 *
 * Переписки в системе у мерчанта нет — вопросы он задаёт в личный
 * Telegram, и ник этот живёт настройкой, а не константой: передать
 * поддержку другому человеку выкаткой значило бы держать мерчантов без
 * ответа до неё.
 *
 * Пустое поле — рабочее состояние: ссылки в кабинете тогда просто нет.
 * Выдуманный ник вёл бы в пустой чат, а это хуже отсутствующей ссылки.
 */
export function MerchantSupport({ settings }: { settings: ServiceSettingsView }) {
  const { error, busy, send } = useSettingsSend();
  const [username, setUsername] = useState(settings.merchantSupportUsername ?? '');

  return (
    <section className="card">
      <h2 className="card__title">Аккаунт поддержки</h2>
      <p className="card__note">
        Ник в Telegram, на который в кабинете мерчанта и в письмах ведёт «Поддержка». Без
        «собаки». Пустое поле — ссылки в кабинете нет.
      </p>
      {error ? <p className="error">{error}</p> : undefined}
      <label className="field">
        <span className="label">Ник</span>
        <input
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="tobee_support"
          autoComplete="off"
        />
      </label>
      <div className="row__actions">
        <button
          type="button"
          disabled={busy}
          className="btn btn--gold"
          onClick={() => send('/api/settings', { merchantSupportUsername: username })}
        >
          Сохранить
        </button>
      </div>
    </section>
  );
}
