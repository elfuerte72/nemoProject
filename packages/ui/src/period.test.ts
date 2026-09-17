import { describe, expect, it } from 'vitest';
import { dayOf, localMidnight, readTzOffset, resolvePeriod } from './period.js';

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

  /*
   * Пятнадцать, сорок пять и сто восемьдесят дней спрашивает кабинет
   * амбассадора: столько назвал владелец в своих отчётах. Панели они
   * не нужны, и в её чипы не ставятся — набор чипов у каждого экрана
   * свой, а разбор адреса один.
   */
  it('знает периоды кабинета амбассадора', () => {
    expect(resolvePeriod({ period: '15d' }, now, 0).from.toISOString()).toBe(
      '2026-08-19T00:00:00.000Z',
    );
    expect(resolvePeriod({ period: '45d' }, now, 0).from.toISOString()).toBe(
      '2026-07-20T00:00:00.000Z',
    );
    const half = resolvePeriod({ period: '180d' }, now, 0);
    expect(half.key).toBe('180d');
    expect(half.to.toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  it('свой период включает последний день целиком', () => {
    const period = resolvePeriod({ period: 'custom', from: '2026-08-01', to: '2026-08-31' }, now, 0);
    expect(period.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  /*
   * «С 15 августа по 15 августа» — один день, и он такой же свой
   * период, как месяц. До 17 сентября 2026 такой выбор молча
   * становился тридцатью днями: границы сравнивались строго, а
   * последний день включительный.
   */
  it('свой период в один день — этот день целиком', () => {
    const period = resolvePeriod({ period: 'custom', from: '2026-08-15', to: '2026-08-15' }, now, 7 * 60);
    expect(period.key).toBe('custom');
    expect(period.from.toISOString()).toBe('2026-08-14T17:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-08-15T17:00:00.000Z');
  });

  it('даты, набранные задом наперёд, — те же дни', () => {
    const period = resolvePeriod({ period: 'custom', from: '2026-09-05', to: '2026-09-01' }, now, 0);
    expect(period.key).toBe('custom');
    expect(period.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });

  /*
   * Ядро отвергает период, у которого начало не раньше конца, и такой
   * отказ на странице — это авария. Разбор адреса поэтому пустого
   * периода не отдаёт никогда, что бы в адресе ни стояло.
   */
  it('период не бывает пустым', () => {
    const future = resolvePeriod({ period: 'custom', from: '2030-01-01' }, now, 0);
    expect(future.key).toBe('custom');
    expect(future.from.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(future.to.toISOString()).toBe('2030-01-02T00:00:00.000Z');

    const asked = [
      { period: 'custom', from: '2026-09-02', to: '2026-09-02' },
      { period: 'custom', from: '2026-09-03' },
      { period: 'custom', from: '2026-09-02' },
      { period: 'custom', from: '2026-09-09', to: '2026-01-01' },
      { period: 'custom', to: '2026-09-01' },
      { period: 'today' },
    ];
    for (const params of asked) {
      for (const offset of [-12 * 60, 0, 7 * 60, 14 * 60]) {
        const period = resolvePeriod(params, now, offset);
        expect(period.from.getTime(), JSON.stringify({ params, offset })).toBeLessThan(
          period.to.getTime(),
        );
      }
    }
  });

  it('незнакомый ключ и битые даты — тридцать дней', () => {
    expect(resolvePeriod({ period: 'yesterday' }, now, 0).key).toBe('30d');
    expect(resolvePeriod({ period: 'custom', from: 'вчера', to: '2026-09-01' }, now, 0).key).toBe(
      '30d',
    );
    expect(resolvePeriod({ period: 'custom', to: '2026-09-01' }, now, 0).key).toBe('30d');
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
