'use client';

import { useEffect, useState } from 'react';
import type { CardApplicationView } from '@nemo/core';
import { ApiError, get, post } from '@/lib/client-api';
import { CARD_STATUS_LABELS } from '@/lib/labels';

/**
 * Заявка на европейскую карту.
 *
 * Экран честно говорит, чего сервис не делает: карту он не выпускает,
 * её данных не хранит и операций по ней не проводит. Обещание обратного
 * стоило бы дороже неудобства — клиент ждал бы от приложения того,
 * чего в нём нет.
 */
export function CardSection() {
  const [applications, setApplications] = useState<CardApplicationView[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const mine = await get<{ applications: CardApplicationView[] }>(
          '/api/card-applications',
        );
        setApplications(mine.applications);
      } catch (failure) {
        setError(
          failure instanceof ApiError ? failure.message : 'Не удалось загрузить заявки',
        );
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  async function submit() {
    setError(undefined);
    setBusy(true);
    try {
      const created = await post<{ application: CardApplicationView }>(
        '/api/card-applications',
      );
      setApplications((current) => [created.application, ...current]);
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : 'Не удалось подать заявку на карту',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.page}>
      <section>
        <h2 style={styles.heading}>Европейская карта</h2>
        <p style={styles.muted}>
          Оставьте заявку — менеджер займётся оформлением у провайдера и будет вести её
          статус. Карту выпускает провайдер: её данные в приложении не хранятся и операций
          по ней здесь нет.
        </p>
        <button type="button" onClick={submit} disabled={busy} style={styles.button}>
          Подать заявку на карту
        </button>
      </section>

      {error ? <p style={styles.error}>{error}</p> : undefined}

      <section>
        <h2 style={styles.heading}>Мои заявки на карту</h2>
        {applications.length === 0 ? (
          <p style={styles.muted}>Заявок на карту пока нет.</p>
        ) : (
          <ul style={styles.list}>
            {applications.map((application) => (
              <li key={application.id} style={styles.item}>
                <div>{CARD_STATUS_LABELS[application.status]}</div>
                <div style={styles.muted}>
                  Подана{' '}
                  {new Date(application.createdAt).toLocaleDateString('ru-RU')}
                  {application.providerReference
                    ? ` · номер у провайдера ${application.providerReference}`
                    : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: '2rem' },
  heading: { fontSize: '1rem', marginBottom: '0.5rem' },
  button: { padding: '0.75rem', fontSize: '1rem', fontWeight: 600, marginTop: '0.75rem' },
  muted: { opacity: 0.7, fontSize: '0.85rem', lineHeight: 1.45 },
  error: { color: '#c0392b', fontSize: '0.9rem' },
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  item: { borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: '0.6rem' },
} satisfies Record<string, React.CSSProperties>;
