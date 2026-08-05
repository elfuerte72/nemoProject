'use client';

import { useState } from 'react';
import { CurrencyFlag, currencyName, currencyPlace } from './flags';
import { ChevronDown } from './icons';
import { Sheet } from './sheet';

/**
 * Выбор валюты направления.
 *
 * Нижним листом, а не списком у самой пилюли: валют выдачи девять, и
 * раскрытый у калькулятора список упирался бы в край экрана. Лист
 * показывает их все сразу и той же механикой, которой клиент уже
 * выбирает реквизиты и сеть.
 *
 * В строке — флаг, код и место, где валюта ходит. Место, а не название:
 * рядом с флагом «THB · Таиланд» читается одним движением, а «THB ·
 * Тайский бат» просит прочесть себя дважды. Название при этом никуда не
 * делось — оно в подписи для экранного диктора, который флага не видит.
 *
 * Выбор делается в два шага: нажатие отмечает строку, кнопка внизу
 * применяет. Шаг лишний ровно до тех пор, пока не промахнёшься пальцем:
 * валюта — это направление сделки, и менять его молча под пальцем,
 * пока лист ещё открыт, значит показывать клиенту чужие числа за спиной
 * листа.
 *
 * Когда выбирать не из чего, кнопки нет вовсе — вместо неё та же
 * пилюля, но неподвижная: нажатие, за которым ничего не происходит,
 * читается как поломка.
 */
export function CurrencyPicker({
  label,
  codes,
  selected,
  onPick,
}: {
  /** Чего именно спрашивают: «что отдаёте», «что хотите получить». */
  readonly label: string;
  readonly codes: readonly string[];
  readonly selected: string;
  readonly onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Отмеченная в листе валюта. Отдельно от выбранной: пока лист открыт,
   * экран за ним остаётся при своём направлении и своих числах.
   */
  const [staged, setStaged] = useState(selected);

  if (codes.length < 2) {
    return (
      <span className="chip chip--static">
        <CurrencyFlag code={selected} />
        {selected}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Отметка ставится при открытии, а не хранится между показами:
          // закрытый без подтверждения лист не должен помнить, куда
          // клиент передумал.
          setStaged(selected);
          setOpen(true);
        }}
        className="chip"
        aria-haspopup="dialog"
        aria-label={`${label}: ${currencyName(selected)}`}
      >
        <CurrencyFlag code={selected} />
        {selected}
        <ChevronDown />
      </button>

      {open ? (
        <Sheet title="Выберите валюту" onClose={() => setOpen(false)}>
          <p className="sheet__body">{label}</p>

          <ul className="pick">
            {codes.map((code) => (
              <li key={code}>
                <button
                  type="button"
                  onClick={() => setStaged(code)}
                  aria-pressed={code === staged}
                  // Подпись собирается целиком: диктор читает её вместо
                  // строки, а в строке стоят и код, и страна. Оставь тут
                  // одно название — тот, кто слушает, не услышит, какую
                  // валюту он выбирает.
                  aria-label={`${code} — ${currencyName(code)}, ${currencyPlace(code)}`}
                  className="pick__item"
                >
                  <span className="pick__mark">
                    <CurrencyFlag code={code} size={30} />
                  </span>
                  <span className="pick__code">{code}</span>
                  <span className="pick__place">{currencyPlace(code)}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="sheet__actions">
            <button
              type="button"
              onClick={() => {
                onPick(staged);
                setOpen(false);
              }}
              className="btn btn--gold"
            >
              Подтвердить выбор
            </button>
          </div>
        </Sheet>
      ) : undefined}
    </>
  );
}
