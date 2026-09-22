'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { markupPercent } from '@/lib/pos/settings';
import { send } from '@/app/ui/send';

/**
 * Своя наценка мерчанта — прямо на экране терминала.
 *
 * Кнопкой с текущим значением, которая раскрывает поле на месте: 22
 * сентября 2026 владелец сначала попросил унести наценку в общие
 * настройки, а посмотрев, вернул её сюда — «добавить прям на страницу
 * pos терминал функцию, чтобы сделать свою наценку». Место одно: в
 * разделе «Настройки» её больше нет, иначе два поля для одного числа
 * разошлись бы при первой правке.
 *
 * Видит её только владелец (право `pricing`), и по нему же отвечает
 * маршрут: за стойкой стоит оператор, а почём торгует кабинет, решает
 * тот, кто отвечает за деньги.
 *
 * Слово «Наценка» — с образца Love&Pay: своего владелец не называл
 * (тикет 20 трекера кабинета).
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
    <div className="markup">
      <button
        type="button"
        className={open ? 'chip chip--on' : 'chip'}
        aria-expanded={open}
        onClick={() => {
          setMarkup(markupPercent(markupBps));
          setComplaint(undefined);
          setOpen(!open);
        }}
      >
        Наценка: {markupPercent(markupBps)} %
      </button>

      {open ? (
        <div className="markup__panel">
          <label className="field field--narrow">
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
            <button type="button" className="btn btn--gold" aria-busy={busy} onClick={() => void save()}>
              {busy ? 'Сохраняем…' : 'Сохранить наценку'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)} disabled={busy}>
              Не сейчас
            </button>
          </div>
        </div>
      ) : undefined}
    </div>
  );
}
