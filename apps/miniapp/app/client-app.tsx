'use client';

import { useEffect, useState } from 'react';
import type { ClientView } from '@nemo/core';
import { ApiError, post } from '@/lib/client-api';
import { getWebApp } from '@/lib/telegram/webapp';
import { BonusSection } from './bonus-section';
import { CardSection } from './card-section';
import { ExchangeScreen } from './exchange-screen';
import { MarketingConsent } from './marketing-consent';

/**
 * Оболочка клиентского приложения: разделы и первый запуск.
 *
 * Клиент создаётся здесь, до того как разделы запросят свои данные:
 * порядок важен — заявки и баллы принадлежат клиенту, которого ещё
 * может не быть. Реферальная привязка тоже выполняется здесь, потому
 * что только тут `telegram_user_id` подтверждён подписью.
 */

type Tab = 'exchange' | 'bonus' | 'card';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'exchange', label: 'Обмен' },
  { id: 'bonus', label: 'Бонусы' },
  { id: 'card', label: 'Карта' },
];

export function ClientApp() {
  const [tab, setTab] = useState<Tab>('exchange');
  const [client, setClient] = useState<ClientView>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const webApp = getWebApp();
    webApp?.ready();
    webApp?.expand();

    void (async () => {
      try {
        const session = await post<{ client: ClientView }>('/api/session');
        setClient(session.client);
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'Не удалось открыть сервис');
      }
    })();
  }, []);

  if (error) {
    return (
      <main style={styles.page}>
        <p style={styles.error}>{error}</p>
      </main>
    );
  }

  // Пока клиента нет, разделы не показываются: они спрашивают у сервера
  // то, что принадлежит клиенту, и получили бы отказ.
  if (!client) {
    return (
      <main style={styles.page}>
        <p style={styles.muted}>Загружаем…</p>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      {/*
        Вопрос висит, пока клиент на него не ответил, а не только при
        первом запуске: закрывший приложение до ответа иначе не увидел
        бы его больше никогда.
      */}
      <MarketingConsent
        askNow={!client.marketingConsentAsked}
        consent={client.marketingConsent}
        onAnswered={(marketingConsent) =>
          setClient({ ...client, marketingConsent, marketingConsentAsked: true })
        }
      />

      <nav style={styles.tabs}>
        {TABS.map((one) => (
          <button
            key={one.id}
            type="button"
            onClick={() => setTab(one.id)}
            style={tab === one.id ? styles.tabActive : styles.tab}
          >
            {one.label}
          </button>
        ))}
      </nav>

      {tab === 'exchange' ? <ExchangeScreen /> : undefined}
      {tab === 'bonus' ? <BonusSection /> : undefined}
      {tab === 'card' ? <CardSection /> : undefined}
    </main>
  );
}

const styles = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    padding: '1.25rem 1.25rem 3rem',
    maxWidth: 480,
    margin: '0 auto',
  },
  tabs: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' },
  tab: {
    flex: 1,
    padding: '0.55rem',
    fontSize: '0.95rem',
    background: 'none',
    border: '1px solid rgba(128,128,128,0.35)',
    color: 'inherit',
    cursor: 'pointer',
  },
  tabActive: {
    flex: 1,
    padding: '0.55rem',
    fontSize: '0.95rem',
    fontWeight: 600,
    border: '1px solid currentColor',
    background: 'rgba(128,128,128,0.15)',
    color: 'inherit',
    cursor: 'pointer',
  },
  muted: { opacity: 0.7, fontSize: '0.85rem' },
  error: { color: '#c0392b', fontSize: '0.9rem' },
} satisfies Record<string, React.CSSProperties>;
