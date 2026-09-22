'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { send } from '@/app/ui/send';

/**
 * Наценка POS-терминала — владельцу, в общих настройках кабинета.
 *
 * До 22 сентября 2026 она стояла кнопкой над самим терминалом; владелец
 * попросил «наценку добавить в общую конфигурацию»: настройку правят
 * раз в месяц, а сотрудник у стойки видел ручку, которую ему крутить
 * нельзя. Здесь её видит только тот, кто вправе менять, — право
 * `pricing`, по которому откажет и маршрут.
 *
 * Слово «Наценка» — с образца Love&Pay: владелец её никак не называл
 * (тикет 20 трекера кабинета).
 */
export function MarkupForm({ percent }: { readonly percent: string }) {
  const router = useRouter();
  const [markup, setMarkup] = useState(percent);
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setComplaint(undefined);
    setSaved(false);
    setBusy(true);
    const reply = await send('/api/pos/settings', { markupPercent: markup });
    setBusy(false);
    if (!reply.ok) {
      setComplaint(reply.complaint);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <section className="card">
      <h2 className="card__title">POS-терминал</h2>
      <p className="card__note">
        Ваша наценка поверх курса сервиса — доход с продажи у стойки. Записывается в каждый счёт
        вместе с курсом, поэтому старые счета от смены наценки не меняются.
      </p>

      <form className="login__form" onSubmit={submit}>
        <label className="field">
          <span className="label">Наценка, %</span>
          <input
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={markup}
            onChange={(event) => {
              setMarkup(event.target.value);
              setSaved(false);
            }}
          />
          <span className="cell__note">От 0 до 100, с точностью до сотой процента.</span>
        </label>

        {complaint ? <p className="error">{complaint}</p> : undefined}

        <div className="row__actions">
          <button type="submit" className="btn btn--gold" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить наценку'}
          </button>
          {saved ? (
            <span className="muted">Сохранено: терминал уже считает по новой наценке</span>
          ) : undefined}
        </div>
      </form>
    </section>
  );
}
