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
export function RequisitesSection({
  current,
  onSaved,
}: {
  current: RequisitesView | null;
  onSaved: (requisites: RequisitesView) => void;
}) {
  const [editing, setEditing] = useState(current === null);
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
      setCardNumber('');
      setEditing(false);
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : 'Не удалось сохранить реквизиты',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!editing && current) {
    return (
      <div style={styles.saved}>
        <span style={styles.label}>Деньги придут на</span>
        <div>
          {current.bankName ? `${current.bankName}, ` : ''}
          {current.cardLast4 ? `карта •••• ${current.cardLast4}` : (current.phone ?? '—')}
        </div>
        <button type="button" onClick={() => setEditing(true)} style={styles.link}>
          Указать другие
        </button>
      </div>
    );
  }

  return (
    <div style={styles.form}>
      <span style={styles.label}>Куда отправить деньги</span>
      <input
        value={bankName}
        onChange={(event) => setBankName(event.target.value)}
        placeholder="Банк"
        style={styles.input}
      />
      <input
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="Телефон для перевода"
        inputMode="tel"
        style={styles.input}
      />
      <input
        value={cardNumber}
        onChange={(event) => setCardNumber(event.target.value)}
        placeholder="Номер карты"
        inputMode="numeric"
        autoComplete="cc-number"
        style={styles.input}
      />
      <p style={styles.muted}>
        Номер карты сохраняется в зашифрованном виде. Дальше вы будете видеть только
        последние четыре цифры — их достаточно, чтобы узнать свою карту.
      </p>
      {error ? <p style={styles.error}>{error}</p> : undefined}
      <div style={styles.row}>
        <button type="button" onClick={save} disabled={busy} style={styles.button}>
          Сохранить реквизиты
        </button>
        {current ? (
          <button type="button" onClick={() => setEditing(false)} style={styles.link}>
            Отмена
          </button>
        ) : undefined}
      </div>
    </div>
  );
}

const styles = {
  saved: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontSize: '0.8rem', opacity: 0.7 },
  input: { padding: '0.6rem', fontSize: '1rem' },
  row: { display: 'flex', gap: '0.75rem', alignItems: 'center' },
  button: { padding: '0.6rem 0.9rem', fontSize: '0.95rem' },
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
  muted: { opacity: 0.7, fontSize: '0.8rem', lineHeight: 1.45 },
  error: { color: '#c0392b', fontSize: '0.9rem' },
} satisfies Record<string, React.CSSProperties>;
