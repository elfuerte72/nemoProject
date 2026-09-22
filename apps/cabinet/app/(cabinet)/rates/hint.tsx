'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Знак «?» у заголовка колонки: объяснение там, где возник вопрос.
 *
 * Нажатие, а не наведение: на телефоне наводить нечем, а с клавиатуры
 * до знака доходят табом. Открытая плашка закрывается повтором,
 * клавишей выхода и нажатием мимо — тем же набором, каким закрывают
 * любое всплывающее в рабочих интерфейсах.
 *
 * Слова — те же, что стоят в блоке «как устроено» ниже
 * (`COLUMN_HINTS`): один источник на оба места, иначе подсказка у
 * колонки и абзац под ней разошлись бы первой же правкой.
 */
export function ColumnHint({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <span ref={root} className="hint">
      <button
        type="button"
        className={open ? 'hint__ask hint__ask--on' : 'hint__ask'}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Что такое «${title}»`}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>
      {open ? (
        <span id={id} role="note" className="hint__pop">
          <span className="hint__title">{title}</span>
          {detail}
        </span>
      ) : undefined}
    </span>
  );
}
