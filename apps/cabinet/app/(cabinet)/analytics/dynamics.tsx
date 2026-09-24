'use client';

import { useState } from 'react';
import { CurrencyFlag } from '@nemo/flags';
import type { SeriesStep } from '@nemo/core';
import { formatAmount } from '@nemo/ui/format';
import { axisLabel, axisMarks, countWord } from '@/lib/analytics-view';
import { STEP_NAMES } from '@/lib/analytics-texts';
import { barTitle } from '@/lib/series-labels';
import { AsTable, type TableView } from './as-table';
import { ColumnChart } from './column-chart';

/**
 * Динамика с переключателем показателя — по образцу Love&Pay: оборот,
 * заявки, получатели одним графиком, выбор над ним.
 *
 * Показатель переключается на месте, без похода на сервер: все числа
 * уже приехали с разрезами, и круг по сети ради того, чтобы нарисовать
 * те же столбики другим числом, — это секунда на каждое нажатие.
 *
 * Оборот стоит в переключателе по валюте, со значком, а не одной
 * кнопкой: складывать валюты нечем (docs/adr/0013), и «оборот» без
 * валюты означал бы, что сервис знает исторический курс. Первым
 * показывается оборот — за ним в аналитику и приходят.
 */

export interface DynamicsPoint {
  readonly at: string;
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly recipients: number;
  readonly turnover: readonly { readonly code: string; readonly amount: string }[];
}

interface Metric {
  readonly key: string;
  readonly label: string;
  /** Значок валюты у кнопки оборота. */
  readonly code?: string;
  /** Что стоит в строке чисел после самого числа. */
  readonly unit: string;
  readonly valueOf: (point: DynamicsPoint) => number;
  readonly sayOf: (point: DynamicsPoint) => string;
}

function metricsFor(currencies: readonly string[]): readonly Metric[] {
  const count = (key: 'submitted' | 'completed' | 'cancelled' | 'recipients', label: string, unit: string): Metric => ({
    key,
    label,
    unit,
    valueOf: (point) => point[key],
    sayOf: (point) => String(point[key]),
  });
  return [
    ...currencies.map((code) => ({
      key: `turnover:${code}`,
      label: code,
      code,
      unit: 'оборот',
      valueOf: (point: DynamicsPoint) =>
        Number(point.turnover.find((one) => one.code === code)?.amount ?? '0'),
      sayOf: (point: DynamicsPoint) => {
        const line = point.turnover.find((one) => one.code === code);
        return line ? `${formatAmount(line.amount)} ${code}` : `0 ${code}`;
      },
    })),
    count('submitted', 'Подано', 'подано'),
    count('completed', 'Исполнено', 'исполнено'),
    count('cancelled', 'Отменено', 'отменено'),
    count('recipients', 'Получатели', 'получателей'),
  ];
}

export function Dynamics({
  points,
  currencies,
  step,
  coarsened = false,
  csvHref,
  table,
}: {
  readonly points: readonly DynamicsPoint[];
  readonly currencies: readonly string[];
  readonly step: SeriesStep;
  /** Ряд крупнее выбранного шага: период длинный, и точек иначе было бы слишком много. */
  readonly coarsened?: boolean;
  /** Выгрузка ряда. Пусто — выгружать нечего. */
  readonly csvHref: string | null;
  /** Тот же ряд таблицей — двойник графика для тех, кто не водит указателем. */
  readonly table: TableView | null;
}) {
  const metrics = metricsFor(currencies);
  const [current, setCurrent] = useState(metrics[0]?.key ?? 'submitted');
  const metric = metrics.find((one) => one.key === current) ?? metrics[0];
  const marks = axisMarks(points.length);
  if (!metric) return undefined;

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Динамика</h2>
          <p className="card__note">
            Шаг — {STEP_NAMES[step]}
            {coarsened ? ' (крупнее выбранного: период длинный)' : ''}, всего{' '}
            {countWord(points.length, ['точка', 'точки', 'точек'])}. Каждое число по своей дате:
            подано по подаче, исполнено и оборот по исполнению
          </p>
        </div>
        <div className="card__tools">
          <div className="seg" role="group" aria-label="Что показать на графике">
            {metrics.map((one) => (
              <button
                key={one.key}
                type="button"
                className={one.key === metric.key ? 'seg__item seg__item--on' : 'seg__item'}
                onClick={() => setCurrent(one.key)}
                aria-pressed={one.key === metric.key}
                {...(one.code ? { 'aria-label': `Оборот в ${one.code}` } : {})}
              >
                {one.code ? <CurrencyFlag code={one.code} size={14} /> : undefined}
                {one.label}
              </button>
            ))}
          </div>
          {csvHref ? (
            <a className="btn btn--ghost btn--tiny" href={csvHref}>
              CSV
            </a>
          ) : undefined}
        </div>
      </div>

      <ColumnChart
        label={metric.code ? `Оборот в ${metric.code} по шагам периода` : `${metric.label} по шагам периода`}
        unit={metric.unit}
        columns={points.map((point, index) => ({
          key: point.at,
          axis: marks[index] ? axisLabel(point.at, step) : '',
          minor: marks[index] === 'minor',
          title: barTitle(point.at, step),
          value: metric.valueOf(point),
          said: metric.sayOf(point),
        }))}
      />

      {table ? <AsTable table={table} /> : undefined}
    </section>
  );
}
