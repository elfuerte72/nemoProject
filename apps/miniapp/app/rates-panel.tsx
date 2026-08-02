'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CurrencyPairView, PreliminaryQuoteView } from '@nemo/core';
import { get } from '@/lib/client-api';
import { formatRateValue } from '@/lib/format';
import { ChevronDown } from './ui/icons';

/**
 * Табло курсов: сколько рублей стоит единица каждой валюты.
 *
 * Только в эту сторону. Обратный курс — «за рубль дают 0,0118 USDT» —
 * формально та же цена, но прочитать её нельзя: у ноля с шестью знаками
 * нет масштаба, с которым человек сравнивает. Направление обмена от
 * этого не зависит: меняют в обе стороны, а показывают одну.
 *
 * Никакой динамики — ни изменения за сутки, ни стрелок роста: источник
 * отдаёт текущую цену, и нарисовать «+0,34 %» означало бы придумать
 * число. Курс справочный (docs/adr/0004).
 */

/** Валюта, в которой клиент считает: сервис работает с рублём. */
const BASE = 'RUB';

/** Сколько валют показывать. Табло — справка, а не витрина биржи. */
const MAX_ROWS = 8;

export function RatesPanel({
  fromCode,
  toCode,
  pairs,
}: {
  readonly fromCode: string;
  readonly toCode: string;
  readonly pairs: readonly CurrencyPairView[];
}) {
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState<Readonly<Record<string, string | null>>>({});

  /** Валюты, которые сервис меняет на рубли, — их и котируем. */
  const codes = useMemo(
    () => [
      ...new Set(
        pairs
          .filter((pair) => pair.kind === 'electronic' && pair.toCode === BASE)
          .map((pair) => pair.fromCode),
      ),
    ],
    [pairs],
  );

  // Валюта выбранного направления показывается свёрнутой строкой: она и
  // есть та, о которой человек спрашивает прямо сейчас.
  const current = fromCode === BASE ? toCode : fromCode;
  const shown = codes.includes(current) ? current : codes[0];
  const rest = codes.filter((code) => code !== shown).slice(0, MAX_ROWS);

  // Свёрнутое табло стоит одной котировки, развёрнутое — остальных.
  // Спрашивать все сразу значило бы задержать экран ради строк, которые
  // никто не раскрывал.
  //
  // Строкой, а не списком: список пересобирается на каждый рендер, и
  // эффект уходил бы за курсами по кругу.
  const wanted = (open ? [shown, ...rest] : [shown]).filter(Boolean).join(',');

  useEffect(() => {
    const missing = wanted.split(',').filter((code) => code && !(code in rates));
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missing.map(async (code) => {
        const params = new URLSearchParams({ fromCode: code, toCode: BASE });
        // Отсутствие котировки — рабочее состояние: строка останется, но
        // без числа. Убирать валюту из списка нельзя — клиент решил бы,
        // что её не меняют.
        const result = await get<{ quote: PreliminaryQuoteView | null }>(
          `/api/quote?${params.toString()}`,
        ).catch(() => ({ quote: null }));
        return [code, result.quote?.rate ?? null] as const;
      }),
    ).then((loaded) => {
      if (!cancelled) setRates((known) => ({ ...known, ...Object.fromEntries(loaded) }));
    });

    return () => {
      cancelled = true;
    };
  }, [wanted, rates]);

  if (!shown) return null;

  const head = (
    <>
      <span className="rates__pair">
        {shown} / {BASE}
      </span>
      <span className="rates__rule" />
      <Rate value={rates[shown]} />
    </>
  );

  if (rest.length === 0) {
    return (
      <div className="rates">
        <div className="rates__head">{head}</div>
      </div>
    );
  }

  return (
    <div className="rates">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rates__head"
        aria-expanded={open}
        aria-label={open ? 'Скрыть остальные курсы' : 'Показать остальные курсы'}
      >
        {head}
        <span className={open ? 'rates__chevron rates__chevron--open' : 'rates__chevron'}>
          <ChevronDown size={11} />
        </span>
      </button>

      {open ? (
        <div className="rates__list">
          {rest.map((code) => (
            <div key={code} className="rates__row">
              <span className="rates__row-pair">
                {code} / {BASE}
              </span>
              <Rate value={rates[code]} row />
            </div>
          ))}
        </div>
      ) : undefined}
    </div>
  );
}

/**
 * Курс или его отсутствие. Неизвестный и отсутствующий различаются: пока
 * ответ не пришёл, сказать «курс назовёт менеджер» — соврать раньше
 * времени.
 */
function Rate({
  value,
  row = false,
}: {
  readonly value: string | null | undefined;
  readonly row?: boolean;
}) {
  const base = row ? 'rates__row-value' : 'rates__value';
  if (value === undefined) return <span className={`${base} ${base}--absent`}>…</span>;
  if (value === null) {
    return (
      <span className={`${base} ${base}--absent`}>
        {row ? 'по запросу' : 'Курс назовёт менеджер'}
      </span>
    );
  }
  return <span className={base}>{formatRateValue(value)}</span>;
}
