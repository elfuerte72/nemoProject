'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CurrencyPairView, PreliminaryQuoteView } from '@nemo/core';
import { get } from '@/lib/client-api';
import { formatAmount } from '@/lib/format';
import { ChevronDown } from './ui/icons';

/**
 * Курс выбранного направления и, по нажатию, остальные направления.
 *
 * Никакой динамики — ни изменения за сутки, ни стрелок роста: источник
 * отдаёт текущую цену, и нарисовать «+0,34 %» означало бы придумать
 * число. Курс здесь справочный (docs/adr/0004), и лишняя точность
 * читалась бы как обещание.
 *
 * Соседние направления запрашиваются только при раскрытии: клиент, чей
 * вопрос — «сколько дадут за мои», не должен оплачивать своим ожиданием
 * котировки, о которых он не спрашивал.
 */

/** Сколько соседних направлений показывать. Список — справка, а не витрина. */
const MAX_ROWS = 6;

interface Row {
  readonly fromCode: string;
  readonly toCode: string;
  readonly rate: string | null;
}

export function RatesPanel({
  fromCode,
  toCode,
  quote,
  pairs,
}: {
  readonly fromCode: string;
  readonly toCode: string;
  readonly quote: PreliminaryQuoteView | null;
  readonly pairs: readonly CurrencyPairView[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly Row[]>();

  const others = useMemo(
    () =>
      pairs
        .filter(
          (pair) =>
            pair.kind === 'electronic' && !(pair.fromCode === fromCode && pair.toCode === toCode),
        )
        .slice(0, MAX_ROWS),
    [pairs, fromCode, toCode],
  );

  useEffect(() => {
    if (!open || others.length === 0) return;

    let cancelled = false;
    void Promise.all(
      others.map(async (pair) => {
        const params = new URLSearchParams({ fromCode: pair.fromCode, toCode: pair.toCode });
        // Отсутствие котировки — рабочее состояние: строка останется, но
        // без числа. Молча выкидывать направление нельзя — клиент решил
        // бы, что его не обменивают.
        const result = await get<{ quote: PreliminaryQuoteView | null }>(
          `/api/quote?${params.toString()}`,
        ).catch(() => ({ quote: null }));
        return { fromCode: pair.fromCode, toCode: pair.toCode, rate: result.quote?.rate ?? null };
      }),
    ).then((loaded) => {
      if (!cancelled) setRows(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, [open, others]);

  const head = (
    <>
      <span className="rates__pair">
        {fromCode} / {toCode}
      </span>
      <span className="rates__rule" />
      {quote ? (
        <span className="rates__value">{formatAmount(quote.rate)}</span>
      ) : (
        <span className="rates__value rates__value--absent">Курс назовёт менеджер</span>
      )}
    </>
  );

  if (others.length === 0) {
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
        aria-label={open ? 'Скрыть другие направления' : 'Показать другие направления'}
      >
        {head}
        <span className={open ? 'rates__chevron rates__chevron--open' : 'rates__chevron'}>
          <ChevronDown size={11} />
        </span>
      </button>

      {open ? (
        <div className="rates__list">
          {rows === undefined ? (
            <div className="rates__row">
              <span className="rates__row-value--absent">Спрашиваем курсы…</span>
            </div>
          ) : (
            rows.map((row) => (
              <div key={`${row.fromCode}>${row.toCode}`} className="rates__row">
                <span className="rates__row-pair">
                  {row.fromCode} → {row.toCode}
                </span>
                {row.rate ? (
                  <span className="rates__row-value">{formatAmount(row.rate)}</span>
                ) : (
                  <span className="rates__row-value rates__row-value--absent">по запросу</span>
                )}
              </div>
            ))
          )}
        </div>
      ) : undefined}
    </div>
  );
}
