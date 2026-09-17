/**
 * Период сводки: из адреса — в границы, из часов браузера — в
 * «сегодня». Один на аналитику панели и обзор кабинета мерчанта.
 *
 * Сервер живёт в UTC, а «сегодня» у администратора в Бангкоке
 * начинается на семь часов раньше. Смещение часового пояса шапка
 * кладёт в куку при первом показе, и полночь считается по нему; без
 * куки — по UTC, и это честно написано подписью периода.
 *
 * Границы — полуинтервал `[from, to)`, как в ядре.
 */

export const TZ_COOKIE = 'nemo_tz';

/*
 * Ключи всех экранов сразу. Какие из них показать чипами, решает сам
 * экран: у панели свои четыре, у кабинета амбассадора — пятнадцать,
 * тридцать, сорок пять, девяносто и сто восемьдесят дней, как их
 * назвал владелец. Разбор адреса при этом один: ссылку на период
 * пересылают, и «45d» должно означать одно и то же везде.
 */
export const periodKeys = [
  'today',
  '7d',
  '15d',
  '30d',
  '45d',
  '90d',
  '180d',
  'custom',
] as const;
export type PeriodKey = (typeof periodKeys)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Сегодня',
  '7d': '7 дней',
  '15d': '15 дней',
  '30d': '30 дней',
  '45d': '45 дней',
  '90d': '90 дней',
  '180d': '180 дней',
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
 * «по 2 сентября» значит до конца 2 сентября, а «с 2 по 2 сентября» —
 * весь этот день.
 *
 * Пустым период не бывает: ядро такой отвергает, и отказ на странице
 * стал бы аварией. Поэтому даты, набранные задом наперёд, называют те
 * же дни, а начало без конца, стоящее после сегодня, — один свой день.
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
    if (from && to) {
      const [first, last] = from <= to ? [from, to] : [to, from];
      return { key: 'custom', from: first, to: new Date(last.getTime() + DAY) };
    }
    if (from) {
      const end = Math.max(tomorrow.getTime(), from.getTime() + DAY);
      return { key: 'custom', from, to: new Date(end) };
    }
  }

  if (params.period === 'today') {
    return { key: 'today', from: todayStart, to: tomorrow };
  }
  const days = DAYS_BY_KEY[params.period as PeriodKey];
  if (days) {
    return { key: params.period as PeriodKey, from: new Date(tomorrow.getTime() - days * DAY), to: tomorrow };
  }
  return { key: '30d', from: new Date(tomorrow.getTime() - 30 * DAY), to: tomorrow };
}

/** Сколько дней в ключе. «Сегодня» и свой период считаются иначе. */
const DAYS_BY_KEY: Partial<Record<PeriodKey, number>> = {
  '7d': 7,
  '15d': 15,
  '30d': 30,
  '45d': 45,
  '90d': 90,
  '180d': 180,
};

/**
 * Годы, в которых у сервиса бывают данные. За их краем граница периода
 * уезжает в десятитысячный или нулевой год, и база отвечает не пустотой,
 * а ошибкой: такой день читается битым, как и «2026-13-40».
 */
const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;

/** «2026-09-02» → местная полночь этого дня. */
function parseDay(raw: string | undefined, offsetMinutes: number): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  if (year < FIRST_YEAR || year > LAST_YEAR) return null;
  const utc = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(utc.getTime())) return null;
  return new Date(utc.getTime() - offsetMinutes * MINUTE);
}

/** Дата «2026-09-02» по местному времени — для полей выбора дня. */
export function dayOf(date: Date, offsetMinutes: number): string {
  return new Date(date.getTime() + offsetMinutes * MINUTE).toISOString().slice(0, 10);
}
