'use client';

import type { KeyboardEvent } from 'react';

/**
 * Поле своей наценки под расчётом.
 *
 * Только разметка: само число живёт в терминале, потому что по нему
 * считается цена. 22 сентября 2026 владелец попросил, чтобы «когда
 * клиент вводит процент, сразу обновлялась цифра, а не когда нажмёшь на
 * пустое пространство», — а для этого набранное должно попадать в
 * расчёт, не дожидаясь ухода из поля.
 *
 * Пустое поле — без наценки, и это правило поля, а не догадка: стереть
 * число проще, чем вспомнить, что «ноль» пишется нулём.
 *
 * Знак процента стоит в самом поле, справа: подпись «%» рядом с ним
 * читалась бы как отдельное слово.
 */
export function MarkupPanel({
  value,
  onChange,
  onSettle,
  complaint,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** Уход из поля и Enter: записать набранное, не дожидаясь паузы. */
  readonly onSettle: () => void;
  readonly complaint: string | undefined;
}) {
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
            className={complaint ? 'input input--wrong' : 'input'}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onSettle}
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
