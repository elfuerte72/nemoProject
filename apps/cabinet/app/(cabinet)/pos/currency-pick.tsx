'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CurrencyFlag } from '@nemo/flags';
import { currencyName, currencyPlace } from '@nemo/types';
import { Icon } from '@nemo/ui';

/**
 * Выбор валюты прямо в строке калькулятора — тем же приёмом, что в Mini
 * App: пилюля со значком валюты и кодом, нажатие раскрывает список.
 *
 * 22 сентября 2026 владелец попросил убрать ряд кнопок над расчётом и
 * выбирать валюту внутри самой панели, «как в самом Mini App». Ряд
 * отвечал на вопрос «что есть», а спрашивают у стойки другое — «в чём
 * этой покупательнице выдать», и спрашивают уже глядя на сумму.
 *
 * Список, а не нижний лист: лист — приём телефона, а кабинет открывают
 * на ноутбуке. Закрывается он повтором, клавишей выхода и нажатием
 * мимо — тем же набором, каким закрывается подсказка у колонки на табло
 * курсов.
 *
 * В строке — значок валюты, код и место, где она ходит: рядом со
 * значком «THB · Таиланд» читается одним движением, а «THB · Тайский
 * бат» просит прочесть себя дважды. Название при этом никуда не делось,
 * оно в подписи для экранного диктора, который значка не видит.
 */
export function CurrencyPick({
  codes,
  selected,
  onPick,
  label,
}: {
  readonly codes: readonly string[];
  readonly selected: string;
  readonly onPick: (code: string) => void;
  /** Чего именно спрашивают: слово идёт экранному диктору. */
  readonly label: string;
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

  /*
   * Выбирать не из чего — пилюля неподвижна: нажатие, за которым ничего
   * не происходит, читается как поломка. Так же устроена пилюля валюты
   * в Mini App.
   */
  if (codes.length < 2) {
    return (
      <span className="calc__code">
        <CurrencyFlag code={selected} size={18} />
        {selected}
      </span>
    );
  }

  return (
    <span ref={root} className="pick">
      <button
        type="button"
        className={open ? 'calc__code calc__code--open' : 'calc__code'}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${currencyName(selected)}`}
        onClick={() => setOpen(!open)}
      >
        <CurrencyFlag code={selected} size={18} />
        {selected}
        <Icon name="chevron" size={14} />
      </button>

      {open ? (
        <span id={id} role="listbox" className="pick__list">
          {codes.map((code) => (
            <button
              key={code}
              type="button"
              role="option"
              aria-selected={code === selected}
              className={code === selected ? 'pick__item pick__item--on' : 'pick__item'}
              onClick={() => {
                onPick(code);
                setOpen(false);
              }}
            >
              <CurrencyFlag code={code} size={18} />
              <span className="pick__code">{code}</span>
              <span className="pick__place">{currencyPlace(code) || currencyName(code)}</span>
            </button>
          ))}
        </span>
      ) : undefined}
    </span>
  );
}
