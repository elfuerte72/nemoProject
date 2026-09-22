'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { markupPercent } from '@/lib/pos/settings';
import { send } from '@/app/ui/send';

/**
 * Своя наценка мерчанта — в строке «Покупатель платит», у самого числа,
 * на которое она влияет.
 *
 * 22 сентября 2026 владелец прошёл по ней трижды: сначала попросил
 * унести в общие настройки, потом вернуть на экран терминала, а увидев
 * её кнопкой над расчётом — «наценку сделать внутри секции „покупатель
 * платит“, а не сверху, это неудобно и плохо видно». Сверху она и
 * вправду стояла отдельно от суммы, которую поднимает.
 *
 * Кнопка с текущим значением, поле раскрывается под строкой: настройку
 * правят редко, и поле, занятое всегда, отнимало бы место у расчёта.
 *
 * Видит её только владелец (право `pricing`), и по нему же отвечает
 * маршрут: за стойкой стоит оператор, а почём торгует кабинет, решает
 * тот, кто отвечает за деньги.
 */
export function MarkupPanel({ markupBps }: { readonly markupBps: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [markup, setMarkup] = useState(markupPercent(markupBps));
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();

  async function save(): Promise<void> {
    if (busy) return;
    setComplaint(undefined);
    setBusy(true);
    const reply = await send('/api/pos/settings', { markupPercent: markup });
    setBusy(false);
    if (!reply.ok) {
      setComplaint(reply.complaint);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className={open ? 'markup__mark markup__mark--on' : 'markup__mark'}
        aria-expanded={open}
        onClick={() => {
          setMarkup(markupPercent(markupBps));
          setComplaint(undefined);
          setOpen(!open);
        }}
      >
        наценка {markupPercent(markupBps)} %
      </button>

      {open ? (
        <div className="markup__panel">
          <label className="markup__field">
            <span className="label">Ваша наценка, %</span>
            <input
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={markup}
              onChange={(event) => setMarkup(event.target.value)}
              aria-label="Наценка в процентах"
            />
          </label>
          <p className="muted">
            Поверх курса сервиса, от 0 до 100: ваш доход с продажи у стойки. Записывается в
            каждый счёт вместе с курсом, поэтому прежние счета не меняются.
          </p>
          {complaint ? <p className="error">{complaint}</p> : undefined}
          <div className="actions">
            <button
              type="button"
              className="btn btn--gold btn--tiny"
              aria-busy={busy}
              onClick={() => void save()}
            >
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--tiny"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Не сейчас
            </button>
          </div>
        </div>
      ) : undefined}
    </>
  );
}
