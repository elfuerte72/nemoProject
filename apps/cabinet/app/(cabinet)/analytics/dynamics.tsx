'use client';

import { useState } from 'react';
import { formatAmount } from '@nemo/ui/format';

/**
 * Динамика столбиками с переключателем показателя.
 *
 * Показатель переключается на месте, без похода на сервер: все числа
 * уже приехали с разрезами, и круг по сети ради того, чтобы нарисовать
 * те же столбики другим числом, — это секунда на каждое нажатие.
 *
 * Оборот стоит в переключателе по валюте, а не одной строкой: складывать
 * валюты нечем (docs/adr/0013), и «оборот» без валюты означал бы, что
 * сервис знает исторический курс.
 *
 * Столбик нулевого шага остаётся на своём месте пустым: ряд, из
 * которого пропали дни, читается как ряд без провалов.
 */

export interface DynamicsPoint {
  readonly at: string;
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly turnover: readonly { readonly code: string; readonly amount: string }[];
}

interface Metric {
  readonly key: string;
  readonly label: string;
  /** Высота столбика. Деньги — числом, точность здесь не нужна. */
  readonly valueOf: (point: DynamicsPoint) => number;
  /** Что сказать о шаге под курсором и экранному диктору. */
  readonly sayOf: (point: DynamicsPoint) => string;
}

function metricsFor(currencies: readonly string[]): readonly Metric[] {
  const counts: readonly Metric[] = [
    {
      key: 'submitted',
      label: 'Подано',
      valueOf: (point) => point.submitted,
      sayOf: (point) => `подано ${point.submitted}`,
    },
    {
      key: 'completed',
      label: 'Исполнено',
      valueOf: (point) => point.completed,
      sayOf: (point) => `исполнено ${point.completed}`,
    },
    {
      key: 'cancelled',
      label: 'Отменено',
      valueOf: (point) => point.cancelled,
      sayOf: (point) => `отменено ${point.cancelled}`,
    },
  ];
  return [
    ...counts,
    ...currencies.map((code) => ({
      key: `turnover:${code}`,
      label: `Оборот, ${code}`,
      valueOf: (point: DynamicsPoint) =>
        Number(point.turnover.find((one) => one.code === code)?.amount ?? '0'),
      sayOf: (point: DynamicsPoint) => {
        const line = point.turnover.find((one) => one.code === code);
        return line ? `${formatAmount(line.amount)} ${code}` : `без оборота в ${code}`;
      },
    })),
  ];
}

export function Dynamics({
  points,
  currencies,
}: {
  readonly points: readonly DynamicsPoint[];
  readonly currencies: readonly string[];
}) {
  const metrics = metricsFor(currencies);
  const [current, setCurrent] = useState(metrics[0]?.key ?? 'submitted');
  const metric = metrics.find((one) => one.key === current) ?? metrics[0];
  if (!metric) return undefined;

  const values = points.map((point) => metric.valueOf(point));
  const top = Math.max(1, ...values);
  /*
   * Девяносто дней в ту же ширину: зазор между столбиками ужимается, а
   * подпись остаётся у каждого четырнадцатого — на большем их число
   * превращается в серую полосу, в которой не прочесть ни одной даты.
   */
  const gap = points.length > 31 ? 2 : 6;
  const labelEvery = Math.ceil(points.length / 14);

  return (
    <>
      <div className="chips">
        {metrics.map((one) => (
          <button
            key={one.key}
            type="button"
            className={one.key === metric.key ? 'chip chip--on' : 'chip'}
            onClick={() => setCurrent(one.key)}
            aria-pressed={one.key === metric.key}
          >
            {one.label}
          </button>
        ))}
      </div>

      <div
        className="bars"
        style={
          { '--bars': points.length, '--bars-gap': `${gap}px` } as React.CSSProperties
        }
        role="img"
        aria-label={`${metric.label} по шагам периода`}
      >
        {points.map((point, index) => {
          const value = values[index] ?? 0;
          return (
            <div
              key={point.at}
              className="bars__day"
              title={`${point.at}: ${metric.sayOf(point)}`}
            >
              <div className="bars__pair">
                <span
                  className={value > 0 ? 'bars__bar bars__bar--done' : 'bars__bar bars__bar--none'}
                  style={{ height: `${Math.round((value / top) * 100)}%` }}
                />
              </div>
              <span className="bars__label">
                {index % labelEvery === 0 ? point.at.slice(5).replace('-', '.') : ''}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
