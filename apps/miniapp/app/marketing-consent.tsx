'use client';

import { useState } from 'react';
import { ApiError, post } from '@/lib/client-api';

/**
 * Согласие на рассылку.
 *
 * При первом входе клиента спрашивают прямо; дальше отписка остаётся
 * одной кнопкой на виду. Отписка, спрятанная в настройках, — это способ
 * не получить её вовсе.
 */
export function MarketingConsent({
  askNow,
  consent,
  onAnswered,
}: {
  askNow: boolean;
  consent: boolean;
  onAnswered: (consent: boolean) => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function answer(value: boolean) {
    setError(undefined);
    setBusy(true);
    try {
      const result = await post<{ marketingConsent: boolean }>('/api/marketing-consent', {
        consent: value,
      });
      onAnswered(result.marketingConsent);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось сохранить ответ');
    } finally {
      setBusy(false);
    }
  }

  if (askNow) {
    return (
      <div style={styles.ask}>
        <p style={styles.text}>
          Присылать вам предложения и новости сервиса? Заявок и их статусов это не
          касается — о них бот сообщает всегда.
        </p>
        <div style={styles.row}>
          <button type="button" onClick={() => answer(true)} disabled={busy} style={styles.button}>
            Присылать
          </button>
          <button type="button" onClick={() => answer(false)} disabled={busy} style={styles.link}>
            Не нужно
          </button>
        </div>
        {error ? <p style={styles.error}>{error}</p> : undefined}
      </div>
    );
  }

  if (!consent) return null;

  return (
    <div style={styles.row}>
      <button type="button" onClick={() => answer(false)} disabled={busy} style={styles.link}>
        Отписаться от рассылки
      </button>
      {error ? <span style={styles.error}>{error}</span> : undefined}
    </div>
  );
}

const styles = {
  ask: {
    border: '1px solid rgba(128,128,128,0.35)',
    padding: '0.9rem',
    marginBottom: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
  },
  text: { fontSize: '0.9rem', lineHeight: 1.45 },
  row: { display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' },
  button: { padding: '0.5rem 0.9rem', fontSize: '0.9rem', fontWeight: 600 },
  link: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: '0.8rem',
    textDecoration: 'underline',
    cursor: 'pointer',
    color: 'inherit',
    opacity: 0.7,
  },
  error: { color: '#c0392b', fontSize: '0.85rem' },
} satisfies Record<string, React.CSSProperties>;
