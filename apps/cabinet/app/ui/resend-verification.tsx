'use client';

import { useState } from 'react';
import { send } from '@/app/ui/send';

/**
 * «Выслать письмо заново» — на экране неподтверждённой почты.
 *
 * Ссылка одноразовая и живёт сутки, а письма теряются: их съедает
 * спам-фильтр, их открывают в понедельник, по ним проходит сканер
 * почтового шлюза. Без этой кнопки мерчант остаётся с неподтверждённым
 * адресом навсегда — анкету к рассмотрению не примут, а завести кабинет
 * заново нельзя: почта занята им же самим.
 */
export function ResendVerification() {
  const [sent, setSent] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function resend(): Promise<void> {
    setComplaint(undefined);
    setBusy(true);

    const result = await send('/api/auth/resend', {});
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <p className="muted">
        Письмо отправлено заново. Прежняя ссылка больше не работает — подтверждайте по новой.
      </p>
    );
  }

  return (
    <>
      {complaint ? <p className="error">{complaint}</p> : undefined}
      <button
        type="button"
        className="btn btn--gold"
        onClick={() => void resend()}
        aria-busy={busy}
      >
        {busy ? 'Отправляем…' : 'Выслать письмо заново'}
      </button>
    </>
  );
}
