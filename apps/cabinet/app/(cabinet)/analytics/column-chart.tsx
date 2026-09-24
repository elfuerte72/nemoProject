'use client';

import { useState, type KeyboardEvent } from 'react';
import { formatAmount } from '@nemo/ui/format';
import { niceTicks } from '@/lib/analytics-view';

/**
 * Столбики с осью — динамика и часы подачи в «Аналитике».
 *
 * Столбики, а не линия, по той же причине, что на обзоре
 * (`app/ui/series-bars.tsx`): это счётчики за отрезок, и между двумя
 * днями ничего не происходит — линия обещала бы непрерывную величину.
 * От обзора их отличает ось с делениями и сетка: здесь рядов больше и
 * они длиннее, и «столбик вдвое выше соседа» без числа на оси читается
 * хуже, чем «восемь против четырёх».
 *
 * Деления — круглые (`niceTicks`), сетка — волоском, столбик не толще
 * двадцати четырёх пикселей и скруглён только сверху: правила скилла
 * `dataviz`. Цель наведения — вся колонка, а не двухпиксельная марка.
 *
 * Числа под курсором — строкой под графиком, а не пузырём: пузырь
 * закрывал бы соседние столбики, с которыми и сравнивают. Пальцем
 * столбик выбирается касанием и остаётся выбранным. С клавиатуры
 * график берёт фокус целиком, а столбик выбирается стрелками — сто
 * восемьдесят остановок табуляцией никто не пройдёт.
 */

export interface Column {
  readonly key: string;
  /** Подпись под столбиком. Пусто — столбик без подписи: всем место не хватит. */
  readonly axis: string;
  /** Подпись второстепенная — на узком экране её нет, остаются главные. */
  readonly minor?: boolean;
  /** Корзина целиком — в строке чисел. */
  readonly title: string;
  readonly value: number;
  /** Число словами для строки: «3 заявки», «238 000 RUB». */
  readonly said: string;
}

export function ColumnChart({
  columns,
  label,
  unit,
  hint = 'Наведите или нажмите на столбик — покажем число',
}: {
  readonly columns: readonly Column[];
  /** Что это за график — для экранного диктора. */
  readonly label: string;
  /** Что за число в строке под графиком: «подано», «оборот». Число ведёт, имя следует. */
  readonly unit: string;
  readonly hint?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(0, ...columns.map((one) => one.value)));
  const top = ticks[ticks.length - 1] ?? 1;
  // Ось шириной в самую длинную подпись: «150 000» в узкой колонке
  // уезжало бы под край карточки.
  const axisWidth = Math.max(...ticks.map((tick) => formatAmount(String(tick)).length));
  const shown = active === null ? undefined : columns[active];
  const at = (value: number) => `${(value / top) * 100}%`;

  function move(event: KeyboardEvent<HTMLDivElement>): void {
    const last = columns.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? Math.min(last, (active ?? -1) + 1)
        : event.key === 'ArrowLeft'
          ? Math.max(0, (active ?? columns.length) - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  return (
    <div className="colchart" style={{ '--axis': `${axisWidth + 1}ch` } as React.CSSProperties}>
      <div className="colchart__frame">
        <div className="colchart__axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="colchart__tick" style={{ bottom: at(tick) }}>
              {formatAmount(String(tick))}
            </span>
          ))}
        </div>
        <div
          className="colchart__plot"
          role="group"
          aria-label={`${label}. Стрелки выбирают столбик.`}
          tabIndex={0}
          onKeyDown={move}
          // Касание пальцем кончается уходом указателя: браузер шлёт
          // `pointerleave` сразу за `pointerup`, и выбранный столбик
          // гас бы, не успев показаться. Палец снимает выбор другим
          // касанием или уходом фокуса.
          onPointerLeave={(event) => {
            if (event.pointerType !== 'touch') setActive(null);
          }}
          onBlur={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <span key={tick} className="colchart__grid" style={{ bottom: at(tick) }} />
          ))}
          <div
            className="colchart__cols"
            style={{ '--cols': columns.length } as React.CSSProperties}
          >
            {columns.map((one, index) => (
              <div
                key={one.key}
                className={index === active ? 'colchart__col colchart__col--active' : 'colchart__col'}
                onPointerEnter={() => setActive(index)}
              >
                <span
                  className={one.value > 0 ? 'colchart__bar' : 'colchart__bar colchart__bar--none'}
                  style={{ height: at(one.value) }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div
        className="colchart__x"
        style={{ '--cols': columns.length } as React.CSSProperties}
        aria-hidden="true"
      >
        {columns.map((one) => (
          <span key={one.key} className={one.minor ? 'colchart__minor' : undefined}>
            {one.axis}
          </span>
        ))}
      </div>
      {/*
        Место у строки занято всегда — при наведении ничего не прыгает.
        Вежливое объявление: диктор назовёт выбранный стрелкой столбик,
        не перебивая.
      */}
      <p className="bars__readout" aria-live="polite">
        {shown ? (
          <>
            <span className="bars__readout-day">{shown.title}</span>
            <span className="bars__readout-pair">
              <b>{shown.said}</b> {unit}
            </span>
          </>
        ) : (
          <span className="bars__readout-hint">{hint}</span>
        )}
      </p>
    </div>
  );
}
