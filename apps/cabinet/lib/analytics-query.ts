import type { SeriesStep } from '@nemo/core';
import { merchantRoleCan, type MerchantUserRole } from '@nemo/types';
import { dayOf, resolvePeriod, type Period } from '@nemo/ui/period';
import { resolveAnalyticsStep, type AnalyticsStepKey } from './analytics-texts';
import { elapsedDays, limitStep, periodDays } from './analytics-view';

/**
 * Что спрошено у аналитики — из адреса, одним разбором на страницу и
 * на выгрузку: файл, посчитанный по другому шагу или другому отбору,
 * чем экран, разошёлся бы с ним молча.
 */
export interface AnalyticsQuery {
  readonly period: Period;
  /** Последний день периода включительно — для подписи и полей дат. */
  readonly lastDay: Date;
  readonly days: number;
  /** Прошедшие сутки периода — делитель темпа (`elapsedDays`). */
  readonly paceDays: number;
  /** Выбранный шаг — его отмечает переключатель и несут ссылки. */
  readonly stepKey: AnalyticsStepKey;
  /** Шаг, которым считается ряд: выбранный или крупнее, если точек слишком много. */
  readonly step: SeriesStep;
  /** Ряд считается крупнее выбранного — подпись графика об этом говорит. */
  readonly coarsened: boolean;
  /** Только заявки того, кто смотрит. */
  readonly mine: boolean;
  /** Кого спрашивать у ядра при «только мои»; иначе — пусто. */
  readonly submittedBy: string | undefined;
  /** Можно ли вообще выбрать «только мои»: наблюдатель заявок не подаёт. */
  readonly canNarrow: boolean;
  /** Параметры адреса без шага и отбора — от них строятся ссылки. */
  readonly base: Readonly<Record<string, string>>;
}

export function readAnalyticsQuery(
  get: (name: string) => string | undefined,
  who: { readonly userId: string | null; readonly role: MerchantUserRole },
  now: Date,
  offsetMinutes: number,
): AnalyticsQuery {
  const period = resolvePeriod({ period: get('period'), from: get('from'), to: get('to') }, now, offsetMinutes);
  const days = periodDays(period.from, period.to);
  const chosen = resolveAnalyticsStep(get('step'), days);
  /*
   * Ряд длинного своего периода считается крупнее выбранного, но в
   * адрес и в переключатель уходит выбранный шаг: иначе «Недели»,
   * навязанные трёхлетним периодом, остались бы и на «30 днях». Что ряд
   * укрупнён, говорит подпись графика.
   */
  const step = limitStep(chosen.step, days);
  /*
   * «Только мои» — по тому, кто подал заявку. У наблюдателя своих
   * заявок не бывает, у ключа API нет человека: отбор им не предлагается,
   * а пришедший адресом — не применяется, иначе экран показал бы нули и
   * выдал бы их за правду о кабинете.
   */
  const canNarrow = who.userId !== null && merchantRoleCan(who.role, 'submit');
  const mine = canNarrow && get('mine') === '1';
  const lastDay = new Date(period.to.getTime() - 1);
  return {
    period,
    lastDay,
    days,
    paceDays: elapsedDays(period.from, period.to, now),
    stepKey: chosen.key,
    step,
    // «Авто» шаг выбирает сам, и «крупнее выбранного» ему не говорится.
    coarsened: chosen.key !== 'auto' && step !== chosen.step,
    mine,
    submittedBy: mine && who.userId !== null ? who.userId : undefined,
    canNarrow,
    base: {
      period: period.key,
      from: dayOf(period.from, offsetMinutes),
      to: dayOf(lastDay, offsetMinutes),
    },
  };
}

/** Адрес с тем же периодом и отбором, поверх которого что-то сменили. */
export function analyticsSearch(
  query: AnalyticsQuery,
  over: Readonly<Record<string, string | undefined>> = {},
): string {
  const params = new URLSearchParams(query.base);
  const values: Record<string, string | undefined> = {
    step: query.stepKey === 'auto' ? undefined : query.stepKey,
    mine: query.mine ? '1' : undefined,
    ...over,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  return params.toString();
}
