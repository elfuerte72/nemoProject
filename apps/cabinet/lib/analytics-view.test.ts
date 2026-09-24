import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import {
  autoStep,
  elapsedDays,
  limitStep,
  axisLabel,
  axisMarks,
  countWord,
  formatPerDay,
  heatLevel,
  hourRange,
  monthEstimate,
  niceTicks,
  outcomeRows,
  perDay,
  periodDays,
  requestsPerDay,
} from './analytics-view';

const amount = (value: string) => Money.toAmount(value);

describe('шаг «Авто»', () => {
  it('до трёх месяцев — по дням, до полугода — по неделям, дальше — по месяцам', () => {
    expect(autoStep(7)).toBe('day');
    expect(autoStep(30)).toBe('day');
    expect(autoStep(90)).toBe('day');
    expect(autoStep(180)).toBe('week');
    expect(autoStep(365)).toBe('month');
  });

  /*
   * Свой период ничем не ограничен: «с 2000 по 2100 год по дням» — это
   * тридцать семь тысяч столбиков, мегабайты страницы и ни одного
   * различимого дня. Шаг сам крупнеет, пока точек не станет обозримо.
   */
  it('на длинном своём периоде шаг крупнеет, пока точек не больше четырёхсот', () => {
    expect(limitStep('day', 365)).toBe('day');
    expect(limitStep('day', 1_000)).toBe('week');
    expect(limitStep('week', 5_000)).toBe('month');
    // Сто лет по месяцам — тысяча двести столбиков: предел держит и месяц.
    expect(limitStep('day', 36_890)).toBe('quarter');
    expect(limitStep('month', 36_890)).toBe('quarter');
  });

  it('темп считает по прошедшей части периода, но не меньше чем по суткам', () => {
    const from = new Date('2026-09-18T00:00:00Z');
    const to = new Date('2026-09-25T00:00:00Z');
    expect(elapsedDays(from, to, new Date('2026-09-24T12:00:00Z'))).toBe(6.5);
    expect(elapsedDays(from, to, new Date('2026-10-01T00:00:00Z'))).toBe(7);
    expect(elapsedDays(new Date('2026-09-24T00:00:00Z'), to, new Date('2026-09-24T00:30:00Z'))).toBe(1);
  });

  it('дни периода считает по границам, а не по часам сервера', () => {
    const from = new Date('2026-08-26T00:00:00+07:00');
    const to = new Date('2026-09-25T00:00:00+07:00');
    expect(periodDays(from, to)).toBe(30);
  });
});

describe('деления оси', () => {
  it('круглые числа от нуля до вершины не ниже самого большого значения', () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(238000)).toEqual([0, 50000, 100000, 150000, 200000, 250000]);
    expect(niceTicks(1)).toEqual([0, 1]);
  });

  it('пустой ряд — ось до единицы, а не деление на ноль', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe('в среднем в день и оценка на месяц', () => {
  it('делит оборот каждой валюты на дни периода и до копеек', () => {
    expect(
      perDay([{ code: 'RUB', amount: amount('100000'), count: 3 }], 30),
    ).toEqual([{ code: 'RUB', amount: '3333.33' }]);
  });

  /*
   * Оценка считается от оборота, а не от округлённого «в день»: умножать
   * уже обрезанное до копеек значило бы потерять тридцать раз по
   * полкопейки.
   */
  it('оценка на месяц — тридцать дней при том же темпе, от полного оборота', () => {
    expect(
      monthEstimate([{ code: 'RUB', amount: amount('100000'), count: 3 }], 7),
    ).toEqual([{ code: 'RUB', amount: '428571.43' }]);
    expect(
      monthEstimate([{ code: 'USDT', amount: amount('6200'), count: 4 }], 90),
    ).toEqual([{ code: 'USDT', amount: '2066.67' }]);
  });

  it('заявок в день — с одним знаком после запятой', () => {
    expect(formatPerDay(14, 90)).toBe('0,2');
    expect(requestsPerDay(14, 90)).toBe(0.2);
    expect(requestsPerDay(45, 30)).toBe(1.5);
    expect(requestsPerDay(0, 30)).toBe(0);
  });
});

describe('воронка исходов', () => {
  it('раскладывает поданные на исполненные, в работе, истёкшие и отменённые', () => {
    const rows = outcomeRows({
      stages: [
        { status: 'new', count: 1 },
        { status: 'in_progress', count: 1 },
        { status: 'rate_confirmed', count: 0 },
        { status: 'payment_received', count: 1 },
        { status: 'completed', count: 10 },
        { status: 'cancelled', count: 3 },
      ],
      expired: 2,
    });
    expect(rows).toEqual([
      { key: 'submitted', count: 16 },
      { key: 'completed', count: 10 },
      { key: 'open', count: 3 },
      { key: 'expired', count: 2 },
      { key: 'cancelled', count: 1 },
    ]);
  });
});

describe('слова и подписи графиков', () => {
  it('склоняет число: одна точка, две точки, пять точек, двадцать одна точка', () => {
    const forms = ['точка', 'точки', 'точек'] as const;
    expect(countWord(1, forms)).toBe('1 точка');
    expect(countWord(3, forms)).toBe('3 точки');
    expect(countWord(11, forms)).toBe('11 точек');
    expect(countWord(21, forms)).toBe('21 точка');
    expect(countWord(90, forms)).toBe('90 точек');
  });

  it('подпись оси: день и неделя — числом и месяцем, месяц — месяцем и годом', () => {
    expect(axisLabel('2026-08-26', 'day')).toBe('26 авг');
    expect(axisLabel('2026-09-07', 'week')).toBe('7 сен');
    expect(axisLabel('2026-09-01', 'month')).toBe('сен 2026');
  });

  /*
   * Подписей не больше, чем читается в ряд, и последняя остаётся всегда:
   * последний столбик — это «сейчас», и без даты он остаться не может.
   */
  it('подписывает не больше восьми столбиков и всегда последний', () => {
    const marks = axisMarks(90);
    expect(marks.filter(Boolean).length).toBeLessThanOrEqual(8);
    expect(marks[89]).toBe('major');
    expect(axisMarks(7).every(Boolean)).toBe(true);
    // На узком экране остаются главные — каждая вторая из подписанных.
    const major = marks.filter((one) => one === 'major').length;
    expect(major).toBe(Math.ceil(marks.filter(Boolean).length / 2));
  });
});

describe('час отрезком', () => {
  it('называет час суток началом и концом, двумя знаками', () => {
    expect(hourRange(9)).toBe('09:00–10:00');
    expect(hourRange(23)).toBe('23:00–24:00');
  });
});

describe('ступень карты нагрузки', () => {
  it('ноль — пустая клетка, остальное — четыре ступени от самой нагруженной', () => {
    expect(heatLevel(0, 8)).toBe(0);
    expect(heatLevel(1, 8)).toBe(1);
    expect(heatLevel(4, 8)).toBe(2);
    expect(heatLevel(6, 8)).toBe(3);
    expect(heatLevel(8, 8)).toBe(4);
    expect(heatLevel(3, 0)).toBe(0);
  });
});
