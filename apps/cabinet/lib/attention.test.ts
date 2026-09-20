import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { attentionOf, type AttentionFacts } from './attention.js';

/**
 * Строка над обзором отвечает на вопрос «надо ли мне что-то делать
 * прямо сейчас». Правило проверяется тестом, а не глазами: на экране
 * видно одно состояние из четырёх, и тихое — то самое, которое смотрят
 * каждый день.
 *
 * Решено 20 сентября 2026 вместе с макетом: тревога **исчезает**, когда
 * всё хорошо. Постоянная плашка «всё в порядке» информации не несёт,
 * место занимает и приучает глаз себя не замечать — а следом человек
 * так же пропустит красную.
 */

const QUIET: AttentionFacts = {
  endpoints: [{ state: 'active' }],
  deliveries: { total: 411, failed: 0 },
  apiCalls: { total: 2140, failed: 0 },
};

describe('что требует внимания', () => {
  it('в спокойный день молчит', () => {
    expect(attentionOf(QUIET)).toBeNull();
  });

  it('молчит и когда точек вебхука нет вовсе', () => {
    expect(attentionOf({ ...QUIET, endpoints: [] })).toBeNull();
  });

  it('падающая точка — тревога с числом непрошедших доставок', () => {
    const one = attentionOf({
      ...QUIET,
      endpoints: [{ state: 'failing' }],
      deliveries: { total: 411, failed: 14 },
    });
    expect(one?.tone).toBe('alarm');
    expect(one?.text).toContain('14 доставок не прошли');
    expect(one?.href).toBe('/webhooks');
  });

  /** Число из другого периода к беде не относится — тогда без числа. */
  it('падающая точка без непрошедших за период — без числа', () => {
    const one = attentionOf({ ...QUIET, endpoints: [{ state: 'failing' }] });
    expect(one?.tone).toBe('alarm');
    expect(one?.text).not.toMatch(/\d/);
  });

  /**
   * Порядок тот же, каким состояния различает ядро: `failing` важнее
   * `paused`. Второе правило об этом разошлось бы с первым.
   */
  it('падающая точка важнее остановленной', () => {
    const one = attentionOf({
      ...QUIET,
      endpoints: [{ state: 'paused' }, { state: 'failing' }],
    });
    expect(one?.label).toBe('Сбой');
  });

  it('остановленная точка — своя тревога', () => {
    const one = attentionOf({ ...QUIET, endpoints: [{ state: 'paused' }] });
    expect(one?.tone).toBe('alarm');
    expect(one?.text).toContain('на паузе');
    expect(one?.href).toBe('/webhooks');
  });

  it('у двух остановленных точек говорится, скольких это касается', () => {
    const one = attentionOf({
      ...QUIET,
      endpoints: [{ state: 'paused' }, { state: 'paused' }],
    });
    expect(one?.text).toContain('2 точек');
  });

  /**
   * Отвергнутый вызов API — не авария: чаще всего это интегратор
   * отлаживает свой код. Поэтому предупреждение, и уступает доставкам.
   */
  it('отвергнутые вызовы — предупреждение, и доставки важнее', () => {
    const softly = attentionOf({ ...QUIET, apiCalls: { total: 2140, failed: 6 } });
    expect(softly?.tone).toBe('warn');
    expect(softly?.href).toBe('/calls');

    const both = attentionOf({
      ...QUIET,
      endpoints: [{ state: 'failing' }],
      apiCalls: { total: 2140, failed: 6 },
    });
    expect(both?.href).toBe('/webhooks');
  });

  it('говорит человеческим языком, а не машинным', () => {
    const cases: AttentionFacts[] = [
      { ...QUIET, endpoints: [{ state: 'failing' }], deliveries: { total: 411, failed: 14 } },
      { ...QUIET, endpoints: [{ state: 'failing' }] },
      { ...QUIET, endpoints: [{ state: 'paused' }] },
      { ...QUIET, endpoints: [{ state: 'paused' }, { state: 'paused' }] },
      { ...QUIET, apiCalls: { total: 2140, failed: 6 } },
    ];
    for (const facts of cases) {
      const one = attentionOf(facts);
      expect(one).not.toBeNull();
      expect(slopComplaints(`${one?.label}. ${one?.text}`)).toEqual([]);
    }
  });
});
