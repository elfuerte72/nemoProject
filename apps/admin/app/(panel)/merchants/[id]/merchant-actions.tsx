'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MerchantStatus } from '@nemo/types';

/**
 * Решения администратора о мерчанте: одобрить, отклонить, отключить,
 * включить обратно.
 *
 * Кнопок ровно столько, сколько разрешает нынешнее состояние: «одобрить»
 * у активного всё равно получила бы отказ операции, но администратор
 * узнал бы об этом уже после нажатия.
 *
 * Отказ и отключение спрашивают подтверждение раскрытием строки, а не
 * гашением кнопки: погашенная теряет фокус, и работающий с клавиатуры
 * оказывается в начале страницы. Причина отказа обязательна — мерчант
 * читает её в кабинете, а не гадает.
 */
export function MerchantActions({
  merchantId,
  status,
}: {
  readonly merchantId: string;
  readonly status: MerchantStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/merchants/${merchantId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const said = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(said.error ?? 'Не вышло. Попробуйте ещё раз');
      }
      setRejecting(false);
      setReason('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не вышло');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">Решение</h2>
        <span className="section__rule" />
      </div>

      {error ? <p className="error">{error}</p> : undefined}

      <div className="actions">
        {status === 'pending' || status === 'rejected' ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => act({ action: 'approve' })}
          >
            Одобрить
          </button>
        ) : undefined}

        {status === 'pending' ? (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => setRejecting((open) => !open)}
          >
            Отклонить
          </button>
        ) : undefined}

        {status === 'active' ? (
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => act({ action: 'disable' })}
          >
            Отключить
          </button>
        ) : undefined}

        {status === 'disabled' ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => act({ action: 'enable' })}
          >
            Включить
          </button>
        ) : undefined}
      </div>

      {rejecting ? (
        <div className="confirm">
          <label className="field">
            <span className="label">Причина отказа</span>
            <textarea
              className="input"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Её прочитает мерчант в кабинете"
            />
          </label>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy || !reason.trim()}
            onClick={() => act({ action: 'reject', reason })}
          >
            Отклонить анкету
          </button>
        </div>
      ) : undefined}
    </section>
  );
}
