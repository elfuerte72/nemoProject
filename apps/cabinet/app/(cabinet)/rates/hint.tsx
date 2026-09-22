'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@nemo/ui';

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
 *
 * Знак — тот же `question` из набора `@nemo/ui`, что стоит в заголовке
 * «Как это устроено»: одна поверхность, один набор, один штрих. Ни
 * рамки, ни заливки — у него нет структуры, которую они бы называли;
 * состояние говорит цвет: тусклый в покое, темнее под курсором,
 * акцентом — пока плашка открыта.
 */
export function ColumnHint({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  const [open, setOpen] = useState(false);
  /* Плашка прижата к правому краю знака, а не к левому: справа места нет. */
  const [toEnd, setToEnd] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  /*
   * Куда открываться, плашка решает сама и до первого кадра: у последней
   * колонки справа край страницы, и плашка, открытая вправо, вылезала
   * за него — документ становился шире окна, появлялась горизонтальная
   * прокрутка, а за краем светлой оболочки кабинета показывался тёмный
   * фон сайта. Мерить, а не назначать сторону колонке: на узком окне
   * за край вылезает и предпоследняя.
   */
  useLayoutEffect(() => {
    if (!open || !pop.current || !root.current) return;
    // От знака, а не от самой плашки: та при повторном открытии уже
    // прижата и померилась бы влезающей — и ушла бы обратно вправо.
    const edge = document.documentElement.clientWidth - 12;
    const left = root.current.getBoundingClientRect().left - 12;
    setToEnd(left + pop.current.offsetWidth > edge);
  }, [open]);

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
    <span ref={root} className="ask">
      <button
        type="button"
        className={open ? 'ask__mark ask__mark--on' : 'ask__mark'}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Что такое «${title}»`}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="question" size={15} />
      </button>
      {open ? (
        <span id={id} ref={pop} role="note" className={toEnd ? 'ask__pop ask__pop--end' : 'ask__pop'}>
          <span className="ask__title">{title}</span>
          {detail}
        </span>
      ) : undefined}
    </span>
  );
}
