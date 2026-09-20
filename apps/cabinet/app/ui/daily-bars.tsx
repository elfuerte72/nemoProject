'use client';

import { useState } from 'react';

/**
 * Подано и исполнено по дням — столбиками, с наведением.
 *
 * Столбики, а не линия: это счётчики за день, и между вторником и
 * средой ничего не происходит — линия обещала бы непрерывную величину.
 * У мерчанта их к тому же единицы в день, и ломаная по таким числам
 * читается как зубцы, а не как движение.
 *
 * Цель наведения — вся колонка дня, вместе с пустым местом над
 * столбиками: попасть в двухпиксельную марку нельзя ни мышью, ни
 * пальцем. Подсвеченная колонка заодно играет роль курсора, за которым
 * человек следит на биржевом графике, — только курсор здесь
 * прилипает к дню, а не гуляет между ними.
 *
 * Подсказка показывает **оба** ряда сразу: наводят на день, а не на
 * ряд, и вопрос у читателя один — «что было в этот день». Число в ней
 * крупное, название ряда тихое: ряд человек уже выбрал глазами, ему
 * нужна величина.
 *
 * Цвета взяты не на глаз: пара проверена на различимость при
 * дальтонизме и на контраст с поверхностью (скилл `dataviz`,
 * `validate_palette.js`). Прежний «подано» был серым и проваливал
 * проверку насыщенности — серый читается как отсутствие данных, а не
 * как ряд.
 */

export interface DailyBar {
  /** День «2026-09-02» — ключ и подпись. */
  readonly day: string;
  readonly submitted: number;
  readonly completed: number;
}

function dayNumber(day: string): string {
  return day.slice(8, 10);
}

function dayTitle(one: DailyBar): string {
  const [, month, day] = one.day.split('-');
  return `${Number(day)}.${month}`;
}

export function DailyBars({ days }: { days: readonly DailyBar[] }) {
  const [active, setActive] = useState<number | null>(null);
  /*
   * У шкалы мягкий потолок: без него день с единственной заявкой
   * упирается в верх кадра — максимум-то равен единице, — и две недели
   * выглядят частоколом одинаковых столбиков, по которому нечего
   * сравнивать. Потолок не врёт: столбик по-прежнему пропорционален
   * числу, просто кадр перестаёт схлопываться на малых величинах.
   */
  const top = Math.max(4, ...days.map((one) => Math.max(one.submitted, one.completed)));
  const shown = active === null ? undefined : days[active];

  return (
    <div className="bars-figure">
      <div
        className="bars"
        style={{ '--bars': days.length } as React.CSSProperties}
        onPointerLeave={() => setActive(null)}
      >
        {days.map((one, index) => (
          <button
            key={one.day}
            type="button"
            className={index === active ? 'bars__day bars__day--active' : 'bars__day'}
            onPointerEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            /*
             * Читающему с экрана колонка называет всё сразу: он не
             * водит указателем и подсказки не увидит.
             */
            aria-label={`${dayTitle(one)}: подано ${one.submitted}, исполнено ${one.completed}`}
          >
            <span className="bars__pair">
              <span
                className={one.submitted ? 'bars__bar bars__bar--sent' : 'bars__bar bars__bar--none'}
                style={{ height: `${Math.round((one.submitted / top) * 100)}%` }}
              />
              <span
                className={one.completed ? 'bars__bar bars__bar--done' : 'bars__bar bars__bar--none'}
                style={{ height: `${Math.round((one.completed / top) * 100)}%` }}
              />
            </span>
            <span className="bars__label" aria-hidden="true">
              {dayNumber(one.day)}
            </span>
          </button>
        ))}
      </div>

      {/*
        Легенда обязательна: рядов два, и различать их одним цветом
        нельзя — читатель с дальтонизмом останется без ключа. Ключ
        повторяет форму марки: у столбиков это прямоугольник.
      */}
      <p className="bars__legend">
        <span className="bars__key bars__key--sent" /> подано
        <span className="bars__key bars__key--done" /> исполнено
      </p>

      {/*
        Строка под графиком, а не плавающий пузырь: он закрывал бы
        соседние дни — те самые, с которыми читатель и сравнивает. Место
        у строки занято всегда, поэтому при наведении ничего не прыгает.
      */}
      <p className="bars__readout" aria-hidden="true">
        {shown ? (
          <>
            <span className="bars__readout-day">{dayTitle(shown)}</span>
            <span className="bars__readout-pair">
              <span className="bars__key bars__key--sent" />
              <b>{shown.submitted}</b> подано
            </span>
            <span className="bars__readout-pair">
              <span className="bars__key bars__key--done" />
              <b>{shown.completed}</b> исполнено
            </span>
          </>
        ) : (
          <span className="bars__readout-hint">Наведите на день — покажем числа</span>
        )}
      </p>
    </div>
  );
}
