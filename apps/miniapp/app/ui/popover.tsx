'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Ответ у кнопки, которая его вызвала.
 *
 * Не нижний лист: тот годится, когда от человека чего-то ждут — ввода,
 * выбора, подтверждения. Короткая справка ничего не ждёт, и уезжать за
 * ней в другой конец экрана незачем — она раскрывается там, где нажали.
 */
export function Popover({
  label,
  onClose,
  menu = false,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  /** Список выбора: у́же справочного текста и с меньшими полями. */
  readonly menu?: boolean;
  readonly children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      {/* Нажатие мимо закрывает: подсказка не должна требовать прицела. */}
      <div className="popover__scrim" onClick={onClose} />
      <div
        ref={panel}
        className={menu ? 'popover popover--menu' : 'popover'}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}
