'use client';

import { useRouter } from 'next/navigation';
import { CurrencyPick } from '../pos/currency-pick';

/**
 * В какой валюте считать суммы плиток — одной пилюлей со списком, а не
 * рядом кнопок: кнопок было столько, сколько валют встретилось в счетах,
 * и ряд из четырёх «Оборот в …» читался как четыре разных показателя.
 * Пилюля та же, что выбирает валюту в POS-терминале: значок, код и
 * список со страной.
 *
 * Выбор живёт в адресе, как период и таб: сводку считает сервер, и
 * ссылку «оборот в батах за неделю» можно переслать.
 */
export function CurrencySwitch({
  codes,
  selected,
  hrefs,
}: {
  readonly codes: readonly string[];
  readonly selected: string;
  /** Адрес страницы с каждой валютой — его собирает сервер вместе с отбором. */
  readonly hrefs: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  return (
    <CurrencyPick
      codes={codes}
      selected={selected}
      label="Валюта оборота"
      onPick={(code) => {
        const href = hrefs[code];
        if (href) router.push(href, { scroll: false });
      }}
    />
  );
}
