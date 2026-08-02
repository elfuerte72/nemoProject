'use client';

import { useState } from 'react';
import type { RequisitesView } from '@nemo/core';
import { ApiError, post } from '@/lib/client-api';

/**
 * Реквизиты для получения денег.
 *
 * Сохранённый номер клиенту больше не показывается — только последние
 * четыре цифры: полный номер расшифровывает лишь админ-панель
 * (docs/adr/0002). Поэтому «изменить» здесь означает «ввести заново», а
 * не «поправить существующий»: править нечего, показать нечего.
 */
export function RequisitesForm({
  current,
  onSaved,
}: {
  readonly current: RequisitesView | null;
  readonly onSaved: (requisites: RequisitesView) => void;
}) {
  const [bankName, setBankName] = useState('');
  const [phone, setPhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(undefined);
    setBusy(true);
    try {
      const saved = await post<{ requisites: RequisitesView }>('/api/requisites', {
        bankName: bankName.trim() || undefined,
        phone: phone.trim() || undefined,
        cardNumber: cardNumber.trim() || undefined,
      });
      onSaved(saved.requisites);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось сохранить реквизиты');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="sheet__body">
        {current
          ? 'Сейчас деньги уходят на сохранённые реквизиты. Новые заменят их: править старые нечего — номер хранится зашифрованным.'
          : 'Номер карты сохраняется в зашифрованном виде. Дальше вы будете видеть только последние четыре цифры — их достаточно, чтобы узнать свою карту.'}
      </p>

      <div className="form">
        <label className="field">
          <span className="field__label">Банк</span>
          <input
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
            placeholder="Например, Сбербанк"
            className="input"
          />
        </label>
        <label className="field">
          <span className="field__label">Телефон для перевода</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+7"
            inputMode="tel"
            className="input"
          />
        </label>
        <label className="field">
          <span className="field__label">Номер карты</span>
          <input
            value={cardNumber}
            onChange={(event) => setCardNumber(event.target.value)}
            placeholder="0000 0000 0000 0000"
            inputMode="numeric"
            autoComplete="cc-number"
            className="input"
          />
        </label>
      </div>

      {error ? <p className="error">{error}</p> : undefined}

      <div className="sheet__actions">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="btn btn--gold"
        >
          Сохранить реквизиты
        </button>
      </div>
    </>
  );
}
