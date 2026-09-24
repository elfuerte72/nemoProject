import { describe, expect, it } from 'vitest';
import { analyticsSearch, readAnalyticsQuery } from './analytics-query';

const now = new Date('2026-09-24T08:00:00Z');
const from = (params: Record<string, string>) => (name: string) => params[name];

describe('адрес аналитики', () => {
  it('«только мои» у оператора сужает выборку до его заявок', () => {
    const query = readAnalyticsQuery(from({ mine: '1' }), { userId: 'u1', role: 'operator' }, now, 0);
    expect(query).toMatchObject({ mine: true, submittedBy: 'u1', canNarrow: true });
  });

  /*
   * Наблюдатель заявок не подаёт: его «мои» — всегда нули, и экран с
   * нулями выдал бы себя за правду о кабинете.
   */
  it('наблюдателю отбор не предлагается и адресом не применяется', () => {
    const query = readAnalyticsQuery(from({ mine: '1' }), { userId: 'u2', role: 'viewer' }, now, 0);
    expect(query).toMatchObject({ mine: false, submittedBy: undefined, canNarrow: false });
  });

  it('«Авто» выбирает шаг по длине периода, явный шаг — как есть', () => {
    const who = { userId: 'u1', role: 'owner' } as const;
    expect(readAnalyticsQuery(from({ period: '365d' }), who, now, 0)).toMatchObject({
      stepKey: 'auto',
      step: 'month',
      days: 365,
    });
    expect(readAnalyticsQuery(from({ period: '365d', step: 'week' }), who, now, 0)).toMatchObject({
      stepKey: 'week',
      step: 'week',
    });
    expect(readAnalyticsQuery(from({ step: 'quarter' }), who, now, 0).stepKey).toBe('auto');
  });

  /*
   * Ряд укрупняется, а выбор человека — нет: в переключатель и в ссылки
   * уходит выбранный шаг, иначе навязанные длинным периодом «Недели»
   * остались бы и на «30 днях».
   */
  it('«по дням» за сто лет считается кварталами, а выбранным остаётся «Дни»', () => {
    const query = readAnalyticsQuery(
      from({ period: 'custom', from: '2000-01-01', to: '2099-12-31', step: 'day' }),
      { userId: 'u1', role: 'owner' },
      now,
      0,
    );
    expect(query).toMatchObject({ step: 'quarter', stepKey: 'day', coarsened: true });
    expect(new URLSearchParams(analyticsSearch(query)).get('step')).toBe('day');
  });

  it('«Авто» на таком периоде тоже крупнеет, но «крупнее выбранного» не называется', () => {
    const query = readAnalyticsQuery(
      from({ period: 'custom', from: '2000-01-01', to: '2099-12-31' }),
      { userId: 'u1', role: 'owner' },
      now,
      0,
    );
    expect(query).toMatchObject({ step: 'quarter', stepKey: 'auto', coarsened: false });
  });

  it('ссылка держит период и отбор, а «Авто» в адрес не пишет', () => {
    const query = readAnalyticsQuery(
      from({ period: '90d', mine: '1' }),
      { userId: 'u1', role: 'owner' },
      now,
      0,
    );
    const search = new URLSearchParams(analyticsSearch(query, { step: 'week' }));
    expect(search.get('period')).toBe('90d');
    expect(search.get('mine')).toBe('1');
    expect(search.get('step')).toBe('week');
    expect(new URLSearchParams(analyticsSearch(query)).has('step')).toBe(false);
    expect(new URLSearchParams(analyticsSearch(query, { mine: undefined })).has('mine')).toBe(false);
  });
});
