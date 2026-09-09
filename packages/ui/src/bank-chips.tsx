'use client';

import { bankSuggestionsFor } from '@nemo/types';

/**
 * Ярлыки под полем «Банк»: нажатие подставляет название целиком.
 *
 * Подсказка, а не выбор из списка: поле остаётся свободным, и банк, для
 * которого ярлыка нет, набирается как раньше. Отмеченным ярлык
 * показывается, когда в поле стоит ровно он, — чтобы набравший «SCB»
 * руками видел то же, что нажавший ярлык.
 *
 * Состав ярлыков — из `@nemo/types` (`bankSuggestionsFor`): тот же, что
 * у клиента в Mini App. Два списка тайских банков разошлись бы молча, и
 * на сверке «Krungthai» с «Krung Thai» оказались бы разными банками.
 *
 * Пустой список не рисуется вовсе — ни рамки, ни отступа: у валюты
 * может не быть банков в принципе (USDT приходит на кошелёк). Своего
 * отступа у ряда нет: он стоит внутри поля, а поле само разводит части
 * на шесть пикселей.
 */
export function BankChips({
  currency,
  value,
  onPick,
  disabled = false,
}: {
  /** Валюта записи: под неё и подбираются банки. */
  readonly currency: string;
  /** Что набрано в поле — по нему ярлык отмечается текущим. */
  readonly value: string;
  readonly onPick: (bank: string) => void;
  readonly disabled?: boolean;
}) {
  const banks = bankSuggestionsFor(currency);
  if (banks.length === 0) return null;

  const current = value.trim().toLowerCase();

  return (
    <div className="chips">
      {banks.map((bank) => (
        <button
          key={bank}
          type="button"
          className={current === bank.toLowerCase() ? 'chip chip--on' : 'chip'}
          onClick={() => onPick(bank)}
          disabled={disabled}
        >
          {bank}
        </button>
      ))}
    </div>
  );
}
