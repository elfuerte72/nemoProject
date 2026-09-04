'use client';

import { useState } from 'react';
import type { ServiceSettingsView } from '@nemo/core';
import { isWholeNumber } from '@/lib/percent';
import { useSettingsSend } from './use-settings-send';

/**
 * Пределы помощника: сколько ответов в сутки одному клиенту и всему
 * сервису. Ноль выключает его совсем — это рабочий выключатель, а не
 * поломка: клиенту отвечает человек, как было до помощника.
 */
export function ConciergeLimits({ settings }: { settings: ServiceSettingsView }) {
  const { error, busy, send } = useSettingsSend();
  const [perClientDaily, setPerClientDaily] = useState(
    String(settings.conciergeRepliesPerClientDaily),
  );
  const [totalDaily, setTotalDaily] = useState(String(settings.conciergeRepliesDaily));

  return (
    <section className="card">
      <h2 className="card__title">Сколько отвечает помощник</h2>
      <p className="card__note">
        Сколько ответов помощник даёт за сутки. Предел исчерпан — на вопросы отвечает
        менеджер, как было до помощника. Ноль выключает его совсем.
      </p>
      {error ? <p className="error">{error}</p> : undefined}
      <div className="form-row">
        <label className="field">
          <span className="label">Одному клиенту</span>
          <input
            className="input"
            value={perClientDaily}
            onChange={(event) => setPerClientDaily(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <label className="field">
          <span className="label">Всему сервису</span>
          <input
            className="input"
            value={totalDaily}
            onChange={(event) => setTotalDaily(event.target.value)}
            inputMode="numeric"
          />
        </label>
      </div>
      <div className="row__actions">
        <button
          type="button"
          disabled={busy || !isWholeNumber(perClientDaily) || !isWholeNumber(totalDaily)}
          className="btn btn--gold"
          onClick={() =>
            send('/api/settings', {
              conciergeRepliesPerClientDaily: Number(perClientDaily),
              conciergeRepliesDaily: Number(totalDaily),
            })
          }
        >
          Сохранить
        </button>
      </div>
    </section>
  );
}
