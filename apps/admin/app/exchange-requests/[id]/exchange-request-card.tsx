'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ExchangeRequestEventView, ManagerExchangeRequestView } from '@nemo/core';
import { STATUS_LABELS } from '@/lib/exchange-request-labels';

/**
 * Действия менеджера над заявкой.
 *
 * Показывается ровно то, что разрешает текущее состояние: кнопка
 * «исполнить» на невзятой заявке всё равно получила бы отказ от
 * операции, но менеджер узнал бы об этом уже после нажатия.
 */

type ExchangeRequestForDisplay = Omit<ManagerExchangeRequestView, 'clientId'> & { clientId: string };

export function ExchangeRequestCard({
  request,
  events,
}: {
  request: ExchangeRequestForDisplay;
  events: readonly ExchangeRequestEventView[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [finalRate, setFinalRate] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [serviceIncome, setServiceIncome] = useState('');
  const [serviceIncomeCode, setServiceIncomeCode] = useState(request.toCode);
  const [reason, setReason] = useState('');

  /**
   * Что состояние заявки позволяет сделать. Собрано в одном месте, а не
   * разбросано по разметке: список действий должен читаться рядом с
   * таблицей переходов, а не собираться из условий по всему экрану.
   */
  const can = {
    claim: request.status === 'new',
    confirmRate: request.status === 'in_progress',
    markPaymentReceived: request.status === 'rate_confirmed',
    complete: request.status === 'payment_received',
    cancel: request.status !== 'completed' && request.status !== 'cancelled',
  };

  async function act(body: Record<string, string>) {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch(`/api/exchange-requests/${request.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? 'Действие не выполнено');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.page}>
      <header>
        <h1 style={styles.heading}>
          {request.fromAmount} {request.fromCode} → {request.toCode}
        </h1>
        <p style={styles.muted}>
          {STATUS_LABELS[request.status]} ·{' '}
          {request.kind === 'cash' ? 'наличные' : 'электронный перевод'} · клиент{' '}
          {request.clientId}
        </p>
        {request.finalRate ? (
          <p style={styles.muted}>
            Курс {request.finalRate}
            {request.toAmount ? `, к выдаче ${request.toAmount} ${request.toCode}` : ''}
          </p>
        ) : undefined}
        {request.serviceIncome ? (
          <p style={styles.muted}>
            Доход по заявке: {request.serviceIncome} {request.serviceIncomeCode}
          </p>
        ) : undefined}
        {request.cancelReason ? (
          <p style={styles.muted}>Причина отмены: {request.cancelReason}</p>
        ) : undefined}
      </header>

      {error ? <p style={styles.error}>{error}</p> : undefined}

      {can.claim ? (
        <button
          type="button"
          onClick={() => act({ action: 'claim' })}
          disabled={busy}
          style={styles.button}
        >
          Взять в работу
        </button>
      ) : undefined}

      {can.confirmRate ? (
        <section style={styles.form}>
          <h2 style={styles.subheading}>Финальный курс</h2>
          <input
            value={finalRate}
            onChange={(event) => setFinalRate(event.target.value)}
            placeholder="Курс"
            inputMode="decimal"
            style={styles.input}
          />
          <input
            value={toAmount}
            onChange={(event) => setToAmount(event.target.value)}
            placeholder={`Сумма к выдаче в ${request.toCode}`}
            inputMode="decimal"
            style={styles.input}
          />
          <textarea
            value={paymentInstructions}
            onChange={(event) => setPaymentInstructions(event.target.value)}
            placeholder="Реквизиты для оплаты — уйдут клиенту в бот"
            rows={3}
            style={styles.input}
          />
          <button
            type="button"
            disabled={busy}
            style={styles.button}
            onClick={() =>
              act({
                action: 'confirm-rate',
                finalRate,
                ...(toAmount ? { toAmount } : {}),
                paymentInstructions,
              })
            }
          >
            Подтвердить курс и выдать реквизиты
          </button>
        </section>
      ) : undefined}

      {can.markPaymentReceived ? (
        <button
          type="button"
          onClick={() => act({ action: 'payment-received' })}
          disabled={busy}
          style={styles.button}
        >
          Оплата поступила
        </button>
      ) : undefined}

      {can.complete ? (
        <section style={styles.form}>
          <h2 style={styles.subheading}>Исполнение заявки</h2>
          <p style={styles.muted}>
            Доход по заявке — база реферальных начислений. Без него заявку закрыть
            нельзя, а поправить его потом означало бы пересчитывать уже начисленное.
          </p>
          <input
            value={serviceIncome}
            onChange={(event) => setServiceIncome(event.target.value)}
            placeholder="Доход по заявке"
            inputMode="decimal"
            style={styles.input}
          />
          <input
            value={serviceIncomeCode}
            onChange={(event) => setServiceIncomeCode(event.target.value)}
            placeholder="Валюта дохода по заявке"
            style={styles.input}
          />
          <button
            type="button"
            disabled={busy}
            style={styles.button}
            onClick={() => act({ action: 'complete', serviceIncome, serviceIncomeCode })}
          >
            Заявка исполнена
          </button>
        </section>
      ) : undefined}

      {can.cancel ? (
        <section style={styles.form}>
          <h2 style={styles.subheading}>Отмена</h2>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Причина — её увидит клиент"
            style={styles.input}
          />
          <button
            type="button"
            disabled={busy}
            style={styles.button}
            onClick={() => act({ action: 'cancel', reason })}
          >
            Отменить заявку
          </button>
        </section>
      ) : undefined}

      <section>
        <h2 style={styles.subheading}>История</h2>
        <ul style={styles.list}>
          {events.map((event, index) => (
            <li key={index} style={styles.muted}>
              {new Date(event.createdAt).toLocaleString('ru-RU')} —{' '}
              {STATUS_LABELS[event.toStatus]}
              {event.actorType === 'client' ? ' (клиент)' : ''}
              {event.comment ? `: ${event.comment}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

const styles = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    padding: '2rem 1.5rem',
    maxWidth: 620,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  heading: { fontSize: '1.3rem', marginBottom: '0.4rem' },
  subheading: { fontSize: '1rem', marginBottom: '0.5rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  input: { padding: '0.6rem', fontSize: '1rem', fontFamily: 'inherit' },
  button: { padding: '0.7rem', fontSize: '1rem', fontWeight: 600 },
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  muted: { opacity: 0.7, fontSize: '0.85rem', lineHeight: 1.5 },
  error: { color: '#c0392b', fontSize: '0.9rem' },
} satisfies Record<string, React.CSSProperties>;
