'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatAmount, formatMoney } from '@nemo/ui/format';
import { normalizeTyped, parseTyped } from '@/lib/new-request';
import { send } from '@/app/ui/send';

/**
 * Что делают со счётом: отмечают оплаченным, отменяют, заявляют
 * возврат.
 *
 * Необратимое спрашивает подтверждение раскрытием строки — тем же
 * правилом, что в панели и в Mini App, — и кнопка при этом не гаснет:
 * погашенная теряет фокус, и работающий с клавиатуры оказывается в
 * начале страницы. Пока идёт запрос, подтверждение не закрывается:
 * закрытое на полпути, оно оставило бы человека без ответа о том, чем
 * всё кончилось.
 */
export function InvoiceActions({
  id,
  status,
  code,
  amount,
}: {
  readonly id: string;
  readonly status: string;
  readonly code: string;
  readonly amount: string;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<'paid' | 'cancelled' | 'refund'>();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [typed, setTyped] = useState(formatAmount(amount));
  const [reason, setReason] = useState('');

  async function act(path: string, body: unknown): Promise<void> {
    setComplaint(undefined);
    setBusy(true);
    const reply = await send(path, body);
    setBusy(false);
    if (!reply.ok) {
      setComplaint(reply.complaint);
      return;
    }
    setAsking(undefined);
    router.refresh();
  }

  if (status === 'cancelled') {
    return <p className="muted">Счёт отменён — делать с ним больше нечего.</p>;
  }

  const refundAmount = parseTyped(typed);

  return (
    <div className="actions">
      {complaint ? <p className="error">{complaint}</p> : undefined}

      {status === 'issued' ? (
        asking === 'paid' ? (
          <div className="actions__ask">
            <p className="muted">
              Покупатель расплатился? Сервис этих денег не видел — отметка ваша и только ваша.
            </p>
            <button
              type="button"
              className="btn btn--gold"
              aria-busy={busy}
              onClick={() => void act(`/api/pos/invoices/${id}`, { status: 'paid' })}
            >
              Да, отметить оплаченным
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setAsking(undefined)}
              disabled={busy}
            >
              Не сейчас
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn--gold" onClick={() => setAsking('paid')}>
            Отметить оплаченным
          </button>
        )
      ) : undefined}

      {status === 'issued' ? (
        asking === 'cancelled' ? (
          <div className="actions__ask">
            <p className="muted">Отменённый счёт назад не возвращается.</p>
            <button
              type="button"
              className="btn btn--danger"
              aria-busy={busy}
              onClick={() => void act(`/api/pos/invoices/${id}`, { status: 'cancelled' })}
            >
              Да, отменить
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setAsking(undefined)}
              disabled={busy}
            >
              Не надо
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => setAsking('cancelled')}>
            Отменить счёт
          </button>
        )
      ) : undefined}

      {status === 'paid' ? (
        asking === 'refund' ? (
          <div className="actions__ask actions__ask--form">
            <label className="field">
              <span className="label">Сколько вернуть</span>
              <input
                className="input"
                inputMode="decimal"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onBlur={() => setTyped(normalizeTyped(typed))}
                aria-label={`Сумма возврата в ${code}`}
              />
              <span className="hint">
                целиком — {formatMoney(amount, code)}; меньшая сумма означает, что остальное
                остаётся у вас
              </span>
            </label>
            <label className="field">
              <span className="label">Причина</span>
              <input
                className="input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Почему возвращаете"
                maxLength={500}
              />
              <span className="hint">останется в истории возврата — по ней о нём и вспомнят</span>
            </label>
            <button
              type="button"
              className="btn btn--gold"
              aria-busy={busy}
              disabled={refundAmount === null || reason.trim().length === 0}
              onClick={() =>
                void act('/api/pos/refunds', { invoiceId: id, amount: typed, reason })
              }
            >
              Заявить возврат
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setAsking(undefined)}
              disabled={busy}
            >
              Не сейчас
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn--soft" onClick={() => setAsking('refund')}>
            Вернуть покупателю
          </button>
        )
      ) : undefined}
    </div>
  );
}
