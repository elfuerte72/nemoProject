/**
 * Статистика рефералки на экране: период по часам того, кто смотрит,
 * сравнение с прошлым периодом словами и столбики по дням.
 *
 * Считает сервер — здесь только то, что нужно нарисовать. Суммы баллов
 * на экране не складываются и не вычитаются: это `Money` в бандле ради
 * одной строки (`backlog.md`, «Прирост баллов за период»); сравнение по
 * суммам показывается прошлым значением, а не разницей. Счётчики —
 * целые, их разница безопасна.
 */

export type PeriodKey = 'today' | '7' | '30' | '90';

export const PERIOD_FILTERS: readonly { readonly id: PeriodKey; readonly label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: '7', label: '7 дней' },
  { id: '30', label: '30 дней' },
  { id: '90', label: '90 дней' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS: Record<PeriodKey, number> = { today: 1, '7': 7, '30': 30, '90': 90 };

/**
 * Границы периода по местным суткам: от полуночи первого дня до
 * следующей полуночи после сегодняшнего. Сервер получает моменты и
 * смещение пояса — дни для столбиков он считает по нему же.
 */
export function periodRange(
  key: PeriodKey,
  now: Date = new Date(),
): { readonly from: Date; readonly to: Date; readonly offsetMinutes: number } {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const to = new Date(midnight.getTime() + DAY_MS);
  const from = new Date(midnight.getTime() - (DAYS[key] - 1) * DAY_MS);
  return { from, to, offsetMinutes: -now.getTimezoneOffset() };
}

export type Tone = 'up' | 'down' | 'flat';

/** «↑ 3 к прошлому», «↓ 2 к прошлому», «как в прошлый» — для целых счётчиков. */
export function compareCount(current: number, previous: number): { tone: Tone; text: string } {
  const delta = current - previous;
  if (delta > 0) return { tone: 'up', text: `↑ ${delta} к прошлому` };
  if (delta < 0) return { tone: 'down', text: `↓ ${-delta} к прошлому` };
  return { tone: 'flat', text: 'как в прошлый' };
}

/**
 * Высота столбика в процентах от самого высокого. Числа приходят
 * строками; для рисунка их точность не важна, а пустой ряд даёт ноль,
 * а не деление на ноль.
 */
export function barHeight(value: string, max: string): number {
  const top = Number(max);
  const own = Number(value);
  if (!(top > 0) || !(own > 0)) return 0;
  return Math.min(100, Math.round((own / top) * 100));
}

/** Самое высокое значение ряда — строкой, как пришло. */
export function tallest(values: readonly string[]): string {
  return values.reduce((best, one) => (Number(one) > Number(best) ? one : best), '0');
}
