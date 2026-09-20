import type { SeriesStep } from '@nemo/core';

/**
 * Как называется корзина ряда.
 *
 * Ядро отдаёт у всех четырёх шагов один ключ — день, с которого
 * корзина начинается, — и превращать его в слова приходится экрану.
 * Мест для имени два, и они разные по тесноте: подпись под столбиком,
 * где помещается три-пять знаков, и строка чисел под фигурой, где
 * места хватает и корзина называется целиком.
 *
 * Считается всё по ключу как по строке, без `toLocaleString`: ключ уже
 * приведён к местному времени того, кто смотрит, и повторный разбор
 * его датой сдвинул бы подпись на сутки у всех, кто восточнее Лондона.
 */

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const;

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
] as const;

const QUARTERS = ['I', 'II', 'III', 'IV'] as const;

function parts(at: string): { year: string; month: number; day: string } {
  const [year = '', month = '01', day = '01'] = at.split('-');
  return { year, month: Number(month) - 1, day };
}

/** Подпись под столбиком — коротко, под ширину одной колонки. */
export function barLabel(at: string, step: SeriesStep): string {
  const { year, month, day } = parts(at);
  if (step === 'day') return day;
  if (step === 'week') return `${day}.${String(month + 1).padStart(2, '0')}`;
  if (step === 'month') return MONTHS_SHORT[month] ?? '';
  return `${QUARTERS[Math.floor(month / 3)] ?? ''}·${year.slice(2)}`;
}

/** Корзина целиком — в строке чисел под фигурой и для экранного диктора. */
export function barTitle(at: string, step: SeriesStep): string {
  const { year, month, day } = parts(at);
  const monthOf = (value: number) => String(value + 1).padStart(2, '0');
  if (step === 'day') return `${Number(day)}.${monthOf(month)}`;
  if (step === 'week') {
    // Воскресенье считается датой, а не сложением чисел: неделя
    // переходит и через месяц, и через год.
    const end = new Date(Date.parse(`${at}T00:00:00Z`) + 6 * 24 * 60 * 60 * 1000);
    const endDay = end.getUTCDate();
    return `${day}.${monthOf(month)} – ${endDay}.${monthOf(end.getUTCMonth())}`;
  }
  if (step === 'month') return `${MONTHS[month] ?? ''} ${year}`;
  return `${QUARTERS[Math.floor(month / 3)] ?? ''} квартал ${year}`;
}

/**
 * Какие столбики подписаны, слева направо.
 *
 * Решает ширина подписи, а не шаг сам по себе: «14.09» двенадцать раз
 * подряд на телефоне слипается в полосу, а «сен» — нет. Лишние гасятся
 * через одну, считая от последней: последняя корзина это «сейчас», и
 * без подписи она остаться не может.
 */
export function barLabelled(count: number, step: SeriesStep): boolean[] {
  const every = step === 'week' ? 2 : 1;
  return Array.from({ length: count }, (_, index) => (count - 1 - index) % every === 0);
}

/**
 * За какой отрезок ряд — словами, для подписи под заголовком.
 *
 * Названо тем же числом, каким ряд и считается (`SERIES_BUCKETS` в
 * ядре): подпись «за две недели» под рядом из двенадцати недель — это
 * не описка, а другая правда о тех же столбиках.
 */
export const SERIES_SPAN: Readonly<Record<SeriesStep, string>> = {
  day: 'за две недели',
  week: 'за двенадцать недель',
  month: 'за год',
  quarter: 'за два года',
};
