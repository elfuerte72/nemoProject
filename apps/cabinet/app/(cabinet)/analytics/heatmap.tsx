'use client';

import { useState, type KeyboardEvent } from 'react';
import { heatLevel } from '@/lib/analytics-view';

/**
 * Карта нагрузки: поданные по дню недели и часу — по образцу Love&Pay.
 *
 * Цвет один, ступеней четыре, от светлого к тёмному, и пустая клетка —
 * серая, а не самая светлая: «ни одной заявки» и «одна» должны
 * различаться сразу. Ступени проверены валидатором скилла `dataviz`
 * (`--ordinal`): светлая держит 2:1 к белому, соседние различимы. Шкала
 * под картой — «меньше … больше», без неё цвет читался бы на глаз.
 *
 * Клетка под курсором называет себя строкой под картой; с клавиатуры
 * карта берёт фокус целиком, клетка выбирается стрелками — сто
 * шестьдесят восемь остановок табуляцией никто не пройдёт.
 */
export function Heatmap({
  rows,
  days,
}: {
  /** Семь строк по двадцать четыре часа, понедельник первым. */
  readonly rows: readonly (readonly number[])[];
  /** Дни недели словами: «Пн», «Вт». */
  readonly days: readonly string[];
}) {
  const [active, setActive] = useState<{ day: number; hour: number } | null>(null);
  const max = Math.max(0, ...rows.flat());
  const shown = active === null ? undefined : (rows[active.day]?.[active.hour] ?? 0);

  function move(event: KeyboardEvent<HTMLDivElement>): void {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
    // Первое нажатие любой стрелки встаёт в начало карты — понедельник,
    // полночь, — а не делает шаг от несуществующей клетки.
    if (active === null && keys.includes(event.key)) {
      event.preventDefault();
      setActive({ day: 0, hour: 0 });
      return;
    }
    const from = active ?? { day: 0, hour: 0 };
    const next =
      event.key === 'ArrowRight'
        ? { day: from.day, hour: Math.min(23, from.hour + 1) }
        : event.key === 'ArrowLeft'
          ? { day: from.day, hour: Math.max(0, from.hour - 1) }
          : event.key === 'ArrowDown'
            ? { day: Math.min(6, from.day + 1), hour: Math.max(0, from.hour) }
            : event.key === 'ArrowUp'
              ? { day: Math.max(0, from.day - 1), hour: Math.max(0, from.hour) }
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  return (
    <div className="heatmap">
      <div
        className="heatmap__grid"
        role="group"
        aria-label="Карта нагрузки: поданные по дням недели и часам. Стрелки выбирают клетку."
        tabIndex={0}
        onKeyDown={move}
        // Касание кончается уходом указателя — выбранная пальцем клетка
        // не должна гаснуть сразу (то же в `column-chart.tsx`).
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') setActive(null);
        }}
        onBlur={() => setActive(null)}
      >
        <span aria-hidden="true" />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="heatmap__hour" aria-hidden="true">
            {hour % 3 === 0 ? hour : ''}
          </span>
        ))}
        {rows.map((line, day) => (
          <Row
            key={days[day] ?? day}
            name={days[day] ?? ''}
            line={line}
            max={max}
            day={day}
            active={active}
            onPoint={setActive}
          />
        ))}
      </div>
      <div className="heatmap__foot">
        <p className="bars__readout" aria-live="polite">
          {active && shown !== undefined ? (
            <>
              <span className="bars__readout-day">
                {days[active.day]}, {String(active.hour).padStart(2, '0')}:00–
                {String(active.hour + 1).padStart(2, '0')}:00
              </span>
              <span className="bars__readout-pair">
                <b>{shown}</b> подано
              </span>
            </>
          ) : (
            <span className="bars__readout-hint">Наведите или нажмите на клетку — покажем число</span>
          )}
        </p>
        <span className="heatmap__scale" aria-hidden="true">
          меньше
          <span className="heatmap__cell heatmap__cell--0" />
          <span className="heatmap__cell heatmap__cell--1" />
          <span className="heatmap__cell heatmap__cell--2" />
          <span className="heatmap__cell heatmap__cell--3" />
          <span className="heatmap__cell heatmap__cell--4" />
          больше
        </span>
      </div>
    </div>
  );
}

function Row({
  name,
  line,
  max,
  day,
  active,
  onPoint,
}: {
  readonly name: string;
  readonly line: readonly number[];
  readonly max: number;
  readonly day: number;
  readonly active: { day: number; hour: number } | null;
  readonly onPoint: (at: { day: number; hour: number }) => void;
}) {
  return (
    <>
      <span className="heatmap__day" aria-hidden="true">
        {name}
      </span>
      {line.map((value, hour) => (
        <span
          key={hour}
          className={`heatmap__cell heatmap__cell--${heatLevel(value, max)}${
            active?.day === day && active.hour === hour ? ' heatmap__cell--active' : ''
          }`}
          onPointerEnter={() => onPoint({ day, hour })}
        />
      ))}
    </>
  );
}
