'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatAmount, formatMoney } from '@nemo/ui/format';
import { normalizeTyped, parseTyped } from '@/lib/new-request';
import { send } from '@/app/ui/send';

/**
 * Что делают со счётом: сообщают об оплате за покупателя (пока платежи
 * принимает имитация), отмечают оплаченным руками, отменяют, заявляют
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
  payable,
  imitation,
  code,
  left,
}: {
  readonly id: string;
  readonly status: string;
  /** Счёт ещё ждёт денег: не оплачен, не отменён, срок не вышел. */
  readonly payable: boolean;
  /** Платёж по счёту принимает имитация: об оплате сообщает кнопка. */
  readonly imitation: boolean;
  readonly code: string;
  /**
   * Сколько по счёту ещё можно вернуть. Остаток, а не сумма счёта:
   * заявленное раньше уже обещано покупателю, и подставленная целиком
   * сумма упиралась бы в отказ «больше остатка» на первом же нажатии.
   */
  readonly left: string;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<'imitate' | 'paid' | 'cancelled' | 'refund'>();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [typed, setTyped] = useState(formatAmount(left));
  const [reason, setReason] = useState('');

  async function act(path: string, body: unknown): Promise<void> {
    // Второе нажатие по тому же действию не уходит: кнопка нарочно не
    // гаснет — погашенная теряет фокус, — и без этой проверки двойной
    // щелчок показывал бы красный отказ сразу после удавшегося действия.
    if (busy) return;
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
  if (status === 'refunded') {
    return <p className="muted">Деньги вернули покупателю целиком — делать со счётом больше нечего.</p>;
  }
  if (status === 'expired') {
    return <p className="muted">Срок оплаты вышел. Нужен новый счёт — создайте его в терминале.</p>;
  }

  const refundAmount = parseTyped(typed);

  return (
    <div className="actions">
      {complaint ? <p className="error">{complaint}</p> : undefined}

      {payable && imitation ? (
        asking === 'imitate' ? (
          <div className="actions__ask">
            <p className="muted">
              Это имитация: денег не будет, счёт станет оплаченным. У банка это место займёт его
              сообщение об оплате.
            </p>
            <button
              type="button"
              className="btn btn--gold"
              aria-busy={busy}
              onClick={() => void act(`/api/pos/invoices/${id}/imitate`, {})}
            >
              Да, покупатель заплатил
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
          <button type="button" className="btn btn--gold" onClick={() => setAsking('imitate')}>
            Покупатель заплатил
          </button>
        )
      ) : undefined}

      {payable ? (
        asking === 'paid' ? (
          <div className="actions__ask">
            <p className="muted">
              Покупатель расплатился мимо сервиса, наличными или переводом? Отметка ваша и только
              ваша.
            </p>
            <button
              type="button"
              className="btn btn--soft"
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
          <button type="button" className="btn btn--soft" onClick={() => setAsking('paid')}>
            Оплачен мимо сервиса
          </button>
        )
      ) : undefined}

      {payable ? (
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
                остаток по счёту — {formatMoney(left, code)}; меньшая сумма означает, что
                остальное остаётся у вас
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
