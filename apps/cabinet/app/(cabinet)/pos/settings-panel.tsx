'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { currencyName } from '@nemo/types';
import { markupPercent, type PosSettings } from '@/lib/pos/settings';
import { send } from '@/app/ui/send';

/**
 * Настройки терминала — владельцу: наценка и валюты для сотрудников.
 *
 * Две кнопки в ряд над терминалом, каждая раскрывает своё поле на
 * месте, а не в модальном окне: настройку правят один раз в месяц, и
 * окно поверх кассы для этого лишнее. На кнопке стоит текущее значение,
 * чтобы не открывать её ради вопроса «а сколько сейчас».
 *
 * Слова у образца: «Наценка», «Валюты». Владелец их не называл, и имена
 * взяты у образца (тикет 20 трекера кабинета).
 */
export function SettingsPanel({
  settings,
  codes,
}: {
  readonly settings: PosSettings;
  /** Все валюты, которыми терминал торгует, включая скрытые. */
  readonly codes: readonly string[];
}) {
  const router = useRouter();
  const [which, setWhich] = useState<'markup' | 'codes'>();
  const [markup, setMarkup] = useState(markupPercent(settings.markupBps));
  const [hidden, setHidden] = useState<readonly string[]>(settings.hiddenCodes);
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();

  const visibleCount = codes.filter((code) => !settings.hiddenCodes.includes(code)).length;

  async function save(body: unknown): Promise<void> {
    if (busy) return;
    setComplaint(undefined);
    setBusy(true);
    const reply = await send('/api/pos/settings', body);
    setBusy(false);
    if (!reply.ok) {
      setComplaint(reply.complaint);
      return;
    }
    setWhich(undefined);
    router.refresh();
  }

  return (
    <section className="card pos-settings">
      <div className="chips">
        <button
          type="button"
          className={which === 'markup' ? 'chip chip--on' : 'chip'}
          aria-expanded={which === 'markup'}
          onClick={() => setWhich(which === 'markup' ? undefined : 'markup')}
        >
          Наценка: {markupPercent(settings.markupBps)} %
        </button>
        <button
          type="button"
          className={which === 'codes' ? 'chip chip--on' : 'chip'}
          aria-expanded={which === 'codes'}
          onClick={() => setWhich(which === 'codes' ? undefined : 'codes')}
        >
          Валюты: {visibleCount} из {codes.length}
        </button>
      </div>

      {complaint ? <p className="error">{complaint}</p> : undefined}

      {which === 'markup' ? (
        <div className="pos-settings__panel">
          <label className="field">
            <span className="label">Ваша наценка, %</span>
            <input
              className="input"
              inputMode="decimal"
              value={markup}
              onChange={(event) => setMarkup(event.target.value)}
              aria-label="Наценка в процентах"
            />
            <span className="hint">
              поверх курса сервиса, от 0 до 100: ваш доход с продажи у стойки, записывается в
              каждый счёт
            </span>
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn btn--gold"
              aria-busy={busy}
              onClick={() => void save({ markupPercent: markup })}
            >
              Сохранить наценку
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setWhich(undefined)}>
              Не сейчас
            </button>
          </div>
        </div>
      ) : undefined}

      {which === 'codes' ? (
        <div className="pos-settings__panel">
          <p className="card__note">Снятая галочка прячет валюту с плиток у всех, кто работает за стойкой.</p>
          <div className="fields__list">
            {codes.map((code) => (
              <label key={code} className="fields__item">
                <input
                  type="checkbox"
                  checked={!hidden.includes(code)}
                  onChange={(event) =>
                    setHidden((was) =>
                      event.target.checked ? was.filter((one) => one !== code) : [...was, code],
                    )
                  }
                />
                {code} · {currencyName(code)}
              </label>
            ))}
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn--gold"
              aria-busy={busy}
              onClick={() => void save({ hiddenCodes: hidden })}
            >
              Сохранить валюты
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setWhich(undefined)}>
              Не сейчас
            </button>
          </div>
        </div>
      ) : undefined}
    </section>
  );
}
