'use client';

import { bankSuggestionsFor } from '@nemo/types';

/**
 * Поле «Банк» и ярлыки под ним.
 *
 * Ярлыки — подсказка, а не список: набрать своё по-прежнему можно, и
 * банка, которого в ярлыках нет, это не касается. Заведены они ради
 * тайского счёта — «Kasikornbank» набирается латиницей на телефоне
 * дольше, чем весь остальной реквизит, — но поле «Банк» стоит и у
 * рублёвых карты с телефоном, и ярлыки у них свои.
 *
 * Какие банки показать, решает `bankSuggestionsFor` из `@nemo/types`:
 * тот же список видит мерчант в кабинете и менеджер в счетах сервиса.
 * Второй список тайских банков разошёлся бы с первым молча, и на сверке
 * «Krungthai» с «Krung Thai» оказались бы разными банками.
 *
 * Отмеченным ярлык показывается, когда в поле стоит ровно он: набравший
 * «SCB» руками видит то же, что нажавший ярлык.
 *
 * Подпись отвязана от поля меткой `for`, а не обёрткой `label`: кнопки
 * внутри неё нажимались бы вместе с полем.
 */
export function BankField({
  currency,
  value,
  placeholder,
  onChange,
}: {
  /** Валюта записи: под неё и подбираются банки. */
  readonly currency: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (bank: string) => void;
}) {
  const banks = bankSuggestionsFor(currency);
  const current = value.trim().toLowerCase();

  return (
    <div className="field">
      <label className="field__label" htmlFor="requisite-bank">
        Банк
      </label>
      <input
        id="requisite-bank"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input"
      />
      {/*
        Пустой ряд не рисуется вовсе: у валюты может не быть банков в
        принципе, и рамка с отступом обещала бы выбор, которого нет.
      */}
      {banks.length > 0 ? (
        <div className="chips">
          {banks.map((bank) => (
            <button
              key={bank}
              type="button"
              onClick={() => onChange(bank)}
              aria-pressed={current === bank.toLowerCase()}
              className="chips__item chips__item--hint"
            >
              {bank}
            </button>
          ))}
        </div>
      ) : undefined}
    </div>
  );
}
