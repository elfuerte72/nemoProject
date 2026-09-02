/**
 * Период аналитики: из адреса — в границы, из часов браузера — в
 * «сегодня».
 *
 * Сервер живёт в UTC, а «сегодня» у администратора в Бангкоке
 * начинается на семь часов раньше. Смещение часового пояса браузер
 * кладёт в куку при первом показе, и полночь считается по нему; без
 * куки — по UTC, и это честно написано подписью периода.
 *
 * Границы — полуинтервал `[from, to)`, как в ядре.
 */

export const TZ_COOKIE = 'nemo_tz';

export const periodKeys = ['today', '7d', '30d', '90d', 'custom'] as const;
export type PeriodKey = (typeof periodKeys)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Сегодня',
  '7d': '7 дней',
  '30d': '30 дней',
  '90d': '90 дней',
  custom: 'Свой период',
};

export interface Period {
  readonly key: PeriodKey;
  readonly from: Date;
  readonly to: Date;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Смещение из куки: минуты к востоку от UTC. Испорченное — ноль. */
export function readTzOffset(raw: string | null | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > 14 * 60) return 0;
  return Math.trunc(value);
}

/** Полночь по местному времени, выраженная моментом UTC. */
export function localMidnight(now: Date, offsetMinutes: number): Date {
  const shifted = new Date(now.getTime() + offsetMinutes * MINUTE);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMinutes * MINUTE);
}

/**
 * Период из параметров адреса. Незнакомый ключ и битые даты — тридцать
 * дней: параметр приходит из адресной строки, и отказом на опечатку
 * отвечать незачем. Свой период — календарные дни включительно:
 * «по 2 сентября» значит до конца 2 сентября.
 */
export function resolvePeriod(
  params: { period?: string | undefined; from?: string | undefined; to?: string | undefined },
  now: Date,
  offsetMinutes: number,
): Period {
  const todayStart = localMidnight(now, offsetMinutes);
  const tomorrow = new Date(todayStart.getTime() + DAY);

  if (params.period === 'custom') {
    const from = parseDay(params.from, offsetMinutes);
    const to = parseDay(params.to, offsetMinutes);
    if (from && to && from < to) {
      return { key: 'custom', from, to: new Date(to.getTime() + DAY) };
    }
    if (from && !to) {
      return { key: 'custom', from, to: tomorrow };
    }
  }

  switch (params.period) {
    case 'today':
      return { key: 'today', from: todayStart, to: tomorrow };
    case '7d':
      return { key: '7d', from: new Date(tomorrow.getTime() - 7 * DAY), to: tomorrow };
    case '90d':
      return { key: '90d', from: new Date(tomorrow.getTime() - 90 * DAY), to: tomorrow };
    default:
      return { key: '30d', from: new Date(tomorrow.getTime() - 30 * DAY), to: tomorrow };
  }
}

/** «2026-09-02» → местная полночь этого дня. */
function parseDay(raw: string | undefined, offsetMinutes: number): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const utc = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(utc.getTime())) return null;
  return new Date(utc.getTime() - offsetMinutes * MINUTE);
}

/** Дата «2026-09-02» по местному времени — для полей выбора дня. */
export function dayOf(date: Date, offsetMinutes: number): string {
  return new Date(date.getTime() + offsetMinutes * MINUTE).toISOString().slice(0, 10);
}
