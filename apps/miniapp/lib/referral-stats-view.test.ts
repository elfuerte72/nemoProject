import { describe, expect, it } from 'vitest';
import { barHeight, compareCount, PERIOD_FILTERS, periodRange } from './referral-stats-view';

/**
 * Статистика рефералки на экране: период по часам того, кто смотрит,
 * сравнение с прошлым периодом словами и столбики по дням.
 *
 * Суммы здесь не складываются — это правило `backlog.md` («Прирост
 * баллов за период»): считает сервер, экран только показывает. Высота
 * столбика — пропорция для рисунка, а не деньги.
 */
describe('период', () => {
  const now = new Date('2026-09-08T15:30:00+03:00');

  it('«сегодня» — от местной полуночи до следующей', () => {
    const { from, to } = periodRange('today', now);
    expect(from.getHours()).toBe(0);
    expect(from.getDate()).toBe(now.getDate());
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('«7 дней» — семь местных суток, включая сегодняшние', () => {
    const { from, to } = periodRange('7', now);
    expect(to.getTime() - from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(to.getTime()).toBe(periodRange('today', now).to.getTime());
  });

  it('смещение пояса — минуты к востоку от UTC, как ждёт сервер', () => {
    const { offsetMinutes } = periodRange('30', now);
    expect(offsetMinutes).toBe(-now.getTimezoneOffset());
  });

  it('фильтры — четыре, с подписями', () => {
    expect(PERIOD_FILTERS.map((one) => one.id)).toEqual(['today', '7', '30', '90']);
  });
});

describe('сравнение с прошлым периодом', () => {
  it('говорит знаком и числом, ноль — словом', () => {
    expect(compareCount(5, 2)).toEqual({ tone: 'up', text: '↑ 3 к прошлому' });
    expect(compareCount(1, 4)).toEqual({ tone: 'down', text: '↓ 3 к прошлому' });
    expect(compareCount(3, 3)).toEqual({ tone: 'flat', text: 'как в прошлый' });
  });
});

describe('столбики', () => {
  it('высота — доля от самого высокого; пустой день — ноль, а не NaN', () => {
    expect(barHeight('50', '100')).toBe(50);
    expect(barHeight('0', '0')).toBe(0);
    expect(barHeight('7', '0')).toBe(0);
    expect(barHeight('3', '3')).toBe(100);
  });
});
