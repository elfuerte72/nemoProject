import { describe, expect, it } from 'vitest';
import { dayOf, localMidnight, readTzOffset, resolvePeriod } from './period';

/**
 * «Сегодня» — по часам того, кто смотрит, а не сервера: сервер в UTC, а
 * администратор в Бангкоке. Границы периодов — полуинтервалы, и свой
 * период включает последний день целиком.
 */
describe('период аналитики', () => {
  // 2 сентября 2026, 03:00 UTC — в Бангкоке (UTC+7) уже 10:00 того же дня,
  // в Нью-Йорке (UTC−4) ещё 23:00 первого сентября.
  const now = new Date('2026-09-02T03:00:00Z');

  it('полночь считается по смещению браузера', () => {
    expect(localMidnight(now, 7 * 60).toISOString()).toBe('2026-09-01T17:00:00.000Z');
    expect(localMidnight(now, -4 * 60).toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(localMidnight(now, 0).toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('сегодня — от местной полуночи до следующей', () => {
    const period = resolvePeriod({ period: 'today' }, now, 7 * 60);
    expect(period.from.toISOString()).toBe('2026-09-01T17:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-09-02T17:00:00.000Z');
  });

  it('семь дней заканчиваются завтрашней полуночью', () => {
    const period = resolvePeriod({ period: '7d' }, now, 0);
    expect(period.from.toISOString()).toBe('2026-08-27T00:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  it('свой период включает последний день целиком', () => {
    const period = resolvePeriod({ period: 'custom', from: '2026-08-01', to: '2026-08-31' }, now, 0);
    expect(period.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('незнакомый ключ и битые даты — тридцать дней', () => {
    expect(resolvePeriod({ period: 'yesterday' }, now, 0).key).toBe('30d');
    expect(resolvePeriod({ period: 'custom', from: 'вчера', to: '2026-09-01' }, now, 0).key).toBe(
      '30d',
    );
    expect(
      resolvePeriod({ period: 'custom', from: '2026-09-05', to: '2026-09-01' }, now, 0).key,
    ).toBe('30d');
  });

  it('смещение из куки: только правдоподобное', () => {
    expect(readTzOffset('420')).toBe(420);
    expect(readTzOffset('-240')).toBe(-240);
    expect(readTzOffset('abc')).toBe(0);
    expect(readTzOffset('9000')).toBe(0);
    expect(readTzOffset(null)).toBe(0);
  });

  it('день по местному времени', () => {
    expect(dayOf(now, 7 * 60)).toBe('2026-09-02');
    expect(dayOf(now, -4 * 60)).toBe('2026-09-01');
  });
});
