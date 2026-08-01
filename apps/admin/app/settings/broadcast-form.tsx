'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BroadcastView } from '@nemo/core';

/**
 * Ручная рассылка.
 *
 * Сообщения уходят только клиентам с действующим согласием — список
 * собирает операция, и обойти его отсюда нельзя. Заблокировавшие бота
 * попадают в недоставленные и рассылку остальным не ломают.
 */
export function BroadcastForm({ broadcasts }: { broadcasts: readonly BroadcastView[] }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function send() {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? 'Рассылка не отправлена');
        return;
      }
      setBody('');
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={styles.block}>
      <h2 style={styles.heading}>Рассылка</h2>
      <p style={styles.muted}>
        Уйдёт только тем, кто дал согласие. Отправка идёт порциями с паузой — на большом
        списке это занимает время, дождитесь результата.
      </p>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        placeholder="Текст рассылки"
        style={styles.input}
      />
      <button type="button" onClick={send} disabled={busy || !body.trim()} style={styles.button}>
        {busy ? 'Отправляем…' : 'Отправить рассылку'}
      </button>
      {error ? <p style={styles.error}>{error}</p> : undefined}

      <h3 style={styles.subheading}>Прошлые рассылки</h3>
      {broadcasts.length === 0 ? (
        <p style={styles.muted}>Рассылок ещё не было.</p>
      ) : (
        <ul style={styles.list}>
          {broadcasts.map((broadcast) => (
            <li key={broadcast.id} style={styles.item}>
              <div>{broadcast.body}</div>
              <div style={styles.muted}>
                {new Date(broadcast.createdAt).toLocaleString('ru-RU')} · получателей{' '}
                {broadcast.recipients} · доставлено {broadcast.delivered} · не удалось{' '}
                {broadcast.failed}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const styles = {
  block: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  heading: { fontSize: '1.05rem' },
  subheading: { fontSize: '0.95rem', marginTop: '0.75rem' },
  input: { padding: '0.6rem', fontSize: '0.95rem', fontFamily: 'inherit' },
  button: { padding: '0.55rem 0.9rem', fontSize: '0.95rem', alignSelf: 'flex-start' },
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  item: { borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: '0.5rem' },
  muted: { opacity: 0.7, fontSize: '0.85rem', lineHeight: 1.45 },
  error: { color: '#c0392b', fontSize: '0.9rem' },
} satisfies Record<string, React.CSSProperties>;
