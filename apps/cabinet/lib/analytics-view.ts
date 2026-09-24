import type { MerchantFunnel, SeriesStep } from '@nemo/core';
import { Money } from '@nemo/types';
import type { MoneyLine } from '@nemo/ui/money-list';

/**
 * Чистая арифметика экрана «Аналитика»: какой шаг выбрать сам, где
 * поставить деления оси, сколько в среднем в день и что будет за месяц
 * при том же темпе. Отдельно от разметки — её проверяет тест, а
 * страница и выгрузка берут отсюда одни и те же числа.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Сколько суток в периоде — по границам, а не по часам. */
export function periodDays(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
}

/**
 * Шаг «Авто»: столько точек, сколько глаз различает на линии. До трёх
 * месяцев — дни (девяносто точек линия держит), до полугода — недели,
 * год — месяцы: триста шестьдесят пять дней сливаются в шум, и провал
 * одного дня за ним не виден, а месяц к месяцу — видно.
 */
export function autoStep(days: number): SeriesStep {
  if (days <= 92) return 'day';
  if (days <= 200) return 'week';
  return 'month';
}

/** Сколько точек динамики обозримо: дальше столбики сливаются, а страница тяжелеет. */
const MOST_POINTS = 400;

/** Шаги от мелкого к крупному и сколько в каждом суток — для счёта точек. */
const STEP_DAYS: readonly (readonly [SeriesStep, number])[] = [
  ['day', 1],
  ['week', 7],
  ['month', 30.44],
  ['quarter', 91.31],
];

/**
 * Шаг, укрупнённый под длину периода. Быстрые чипы не длиннее года, но
 * свой период ничем не ограничен, и «по дням за сто лет» дало бы тридцать
 * семь тысяч столбиков. Крупнеет до первого шага, при котором точек не
 * больше четырёхсот; квартал — предел, крупнее шагов у ядра нет.
 */
export function limitStep(step: SeriesStep, days: number): SeriesStep {
  const from = STEP_DAYS.findIndex(([one]) => one === step);
  for (const [one, size] of STEP_DAYS.slice(Math.max(0, from))) {
    if (days / size <= MOST_POINTS) return one;
  }
  return 'quarter';
}

/**
 * Сколько суток периода уже прошло — для «в среднем в день» и прогноза.
 * Сегодняшний день идёт в счёт своей прошедшей частью: у «7 дней» в
 * десять утра прошло шесть с небольшим суток, и делить на семь значило бы
 * занизить темп на седьмую часть. Но не меньше суток: иначе ранним утром
 * «сегодня» полчаса оборота умножались бы на полторы тысячи.
 */
export function elapsedDays(from: Date, to: Date, now: Date): number {
  const end = Math.min(to.getTime(), now.getTime());
  return Math.max(1, (end - from.getTime()) / DAY);
}

/**
 * Деления оси от нуля: шаг — единица, двойка или пятёрка нужного
 * порядка, делений не больше пяти, вершина не ниже самого большого
 * значения. Шаг не меньше единицы: оборот в долях монеты бывает, а
 * «0,2 заявки» — нет.
 */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  let step = 1;
  const power = Math.floor(Math.log10(max));
  search: for (let magnitude = 10 ** Math.max(0, power - 1); ; magnitude *= 10) {
    for (const factor of [1, 2, 5]) {
      const candidate = factor * magnitude;
      if (Math.ceil(max / candidate) <= 5) {
        step = candidate;
        break search;
      }
    }
  }
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top; tick += step) ticks.push(tick);
  return ticks;
}

/** Сумма каждой валюты, умноженная на `times` и делённая на дни, — до сотых. */
function scaleByDays(lines: readonly MoneyLine[], days: number, times: number): MoneyLine[] {
  const perDays = Money.toAmount(String(Math.max(1, days)));
  return lines.map((line) => ({
    code: line.code,
    amount: Money.roundTo(
      Money.divide(Money.multiply(line.amount, Money.toAmount(String(times))), perDays),
      2,
    ),
  }));
}

/** Оборот в среднем за сутки периода — по каждой валюте. */
export function perDay(lines: readonly MoneyLine[], days: number): MoneyLine[] {
  return scaleByDays(lines, days, 1);
}

/**
 * Оценка на месяц: тридцать дней при том же темпе. Считается от
 * оборота, а не от округлённого «в среднем в день» — умножать уже
 * обрезанное до сотых значило бы потерять тридцать раз по полкопейки.
 * Это оценка, а не обещание, и экран так её и подписывает.
 */
export function monthEstimate(lines: readonly MoneyLine[], days: number): MoneyLine[] {
  return scaleByDays(lines, days, 30);
}

/** Заявок в сутки — с одним знаком: «0,2», а не «0,1555…». */
export function requestsPerDay(submitted: number, days: number): number {
  return Math.round((submitted / Math.max(1, days)) * 10) / 10;
}

/** То же словами для экрана и файла — запятой, как пишут по-русски: «0,2». */
export function formatPerDay(submitted: number, days: number): string {
  return String(requestsPerDay(submitted, days)).replace('.', ',');
}

/** Час суток отрезком — «18:00–19:00»: одна запись на график, карту и файл. */
export function hourRange(hour: number): string {
  const at = (value: number) => `${String(value).padStart(2, '0')}:00`;
  return `${at(hour)}–${at(hour + 1)}`;
}

export type OutcomeKey = 'submitted' | 'completed' | 'open' | 'expired' | 'cancelled';

/**
 * Воронка исходов: куда ушли поданные в период. Просроченные стоят
 * своей строкой и из отменённых вычтены — отменённой их делает срок
 * оплаты, а не человек, и «отменено» без этого смешало бы две причины.
 */
export function outcomeRows(funnel: MerchantFunnel): { key: OutcomeKey; count: number }[] {
  const of = (status: string) => funnel.stages.find((one) => one.status === status)?.count ?? 0;
  const submitted = funnel.stages.reduce((total, one) => total + one.count, 0);
  const completed = of('completed');
  const cancelled = of('cancelled');
  return [
    { key: 'submitted', count: submitted },
    { key: 'completed', count: completed },
    { key: 'open', count: submitted - completed - cancelled },
    { key: 'expired', count: funnel.expired },
    { key: 'cancelled', count: cancelled - funnel.expired },
  ];
}

/**
 * Ступень клетки карты нагрузки: пусто или одна из четырёх — от самой
 * нагруженной клетки. Ступеней четыре, а не плавный цвет: пять оттенков
 * одного цвета глаз различает, двадцать — нет (скилл `dataviz`).
 */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4))) as 1 | 2 | 3 | 4;
}

/** Доля от целого, 0..1; без целого — пусто, а не ноль. */
export function shareOf(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

/**
 * Число со словом в нужной форме: «1 точка», «3 точки», «11 точек».
 * Формы — именительный единственного, родительный единственного и
 * родительный множественного.
 */
export function countWord(
  count: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  const tens = Math.abs(count) % 100;
  const ones = tens % 10;
  const form =
    tens >= 11 && tens <= 14
      ? forms[2]
      : ones === 1
        ? forms[0]
        : ones >= 2 && ones <= 4
          ? forms[1]
          : forms[2];
  return `${count} ${form}`;
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * Подпись под столбиком оси. Считается по ключу как по строке: ключ уже
 * в местном времени того, кто смотрит, и разбор его датой сдвинул бы
 * подпись на сутки (то же правило, что в `series-labels.ts`).
 */
export function axisLabel(at: string, step: SeriesStep): string {
  const [year = '', month = '01', day = '01'] = at.split('-');
  const name = MONTHS_SHORT[Number(month) - 1] ?? '';
  return step === 'month' || step === 'quarter' ? `${name} ${year}` : `${Number(day)} ${name}`;
}

/**
 * Какие столбики подписать: не больше восьми подписей, через равный
 * шаг, считая от последнего — последний это «сейчас», и без даты он
 * остаться не может.
 *
 * Подпись бывает главной и второстепенной: на телефоне остаются только
 * главные — каждая вторая, — иначе восемь дат в триста пикселей
 * слипаются в одну строку. Главные — подмножество всех, поэтому на
 * узком экране ряд редеет, а не перестраивается.
 */
export function axisMarks(count: number, most = 8): ('major' | 'minor' | null)[] {
  const every = Math.max(1, Math.ceil(count / most));
  return Array.from({ length: count }, (_, index) => {
    const fromEnd = count - 1 - index;
    if (fromEnd % (every * 2) === 0) return 'major';
    return fromEnd % every === 0 ? 'minor' : null;
  });
}

