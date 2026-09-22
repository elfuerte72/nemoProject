'use client';

import { useRouter } from 'next/navigation';
import { useState, type KeyboardEvent } from 'react';
import { markupPercent } from '@/lib/pos/settings';
import { send } from '@/app/ui/send';

/**
 * Своя наценка мерчанта — полем под расчётом, рядом с верификацией.
 *
 * 22 сентября 2026 владелец прошёл по ней четырежды: в общие настройки,
 * обратно на экран, из шапки страницы в строку оплаты и, наконец, сюда
 * — «пусть она будет снизу, над проверкой KYC, и сразу форма для
 * написания цифры в процентах; если пусто, то без наценки». Поле,
 * которое видно всегда, а не кнопка с раскрытием: наценку задают перед
 * сменой, а не ищут.
 *
 * Пустое поле — без наценки, и это правило поля, а не догадка: стереть
 * число проще, чем вспомнить, что «ноль» пишется нулём.
 *
 * Сохраняется по уходу из поля и по Enter: отдельная кнопка рядом с
 * одним полем ничего не добавляет, а цена на экране пересчитывается
 * сразу и служит ответом. Пока сохранение идёт, поле не блокируется —
 * блокировка на полсекунды сбивает набор.
 *
 * Видит поле только владелец (право `pricing`), и по нему же отвечает
 * маршрут: за стойкой стоит оператор, а почём торгует кабинет, решает
 * тот, кто отвечает за деньги.
 */
export function MarkupPanel({ markupBps }: { readonly markupBps: number }) {
  const router = useRouter();
  const saved = markupBps === 0 ? '' : markupPercent(markupBps);
  const [typed, setTyped] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();

  async function save(): Promise<void> {
    const next = typed.trim();
    // Ничего не изменилось — и сохранять нечего: уход из поля случается
    // на каждом нажатии мимо.
    if (busy || next === saved) return;
    setComplaint(undefined);
    setBusy(true);
    const reply = await send('/api/pos/settings', { markupPercent: next === '' ? '0' : next });
    setBusy(false);
    if (!reply.ok) {
      setComplaint(reply.complaint);
      return;
    }
    router.refresh();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  return (
    <div className="markup">
      <label className="markup__field">
        <span className="label">Ваша наценка</span>
        <span className="markup__input">
          <input
            className="input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={onKey}
            aria-label="Наценка в процентах"
          />
          <span className="markup__sign" aria-hidden>
            %
          </span>
        </span>
      </label>
      <span className="hint">
        {complaint ? (
          <span className="error">{complaint}</span>
        ) : (
          'поверх курса сервиса, ваш доход с продажи; пусто — без наценки'
        )}
      </span>
    </div>
  );
}
