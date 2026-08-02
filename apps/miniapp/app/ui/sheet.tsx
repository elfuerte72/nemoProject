'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Нижний лист.
 *
 * Всё, что не помещается в основной поток экрана — выбор валюты, ввод
 * реквизитов, подтверждение заявки, — показывается здесь, а не отдельной
 * страницей. Приложение живёт внутри Telegram, и своя навигация в нём
 * спорит с системной кнопкой «назад».
 *
 * Разметка уходит в конец `body`, а не остаётся на месте вызова:
 * экраны въезжают анимацией `transform`, а такой предок становится
 * системой отсчёта для `position: fixed` — лист внутри него перестаёт
 * закрывать нижнюю панель.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    // Фон под листом не прокручивается: иначе палец, промахнувшийся
    // мимо панели, уводит экран под ней.
    document.body.classList.add('sheet-open');

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('sheet-open');
    };
  }, [onClose]);

  const markup = (
    <div
      className="sheet"
      // Закрытие по промаху мимо панели — нажатие на саму подложку, а не
      // всплывшее из панели событие.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet__grabber" />
        <h2 id={titleId} className="sheet__title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );

  // Лист открывается только по действию клиента, то есть уже в
  // браузере: разметки для страницы, отданной сервером, у него нет.
  return typeof document === 'undefined' ? null : createPortal(markup, document.body);
}

/**
 * Лист с одним сообщением и кнопкой «Понятно» — подтверждение подачи,
 * пояснение к шагу, ответ поддержки.
 */
export function NoticeSheet({
  title,
  body,
  onClose,
}: {
  readonly title: string;
  readonly body: string;
  readonly onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="sheet__body">{body}</p>
      <div className="sheet__actions">
        <button type="button" onClick={onClose} className="btn btn--gold">
          Понятно
        </button>
      </div>
    </Sheet>
  );
}
