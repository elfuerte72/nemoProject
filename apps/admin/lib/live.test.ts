import { describe, expect, it } from 'vitest';
import { eventConcerns, LIVE_REFRESH_MS, shouldRefresh } from './live';

/**
 * Когда очередь имеет право обновиться сама.
 *
 * Решение это не про разметку, а про то, что происходит под руками у
 * человека: перерисовка посреди набранного отнимает набранное, а опрос
 * скрытой вкладки — заряд телефона, на котором панель открыта весь день.
 */

describe('тихое обновление', () => {
  it('идёт на видимой вкладке в покое', () => {
    expect(shouldRefresh({ hidden: false, busy: false, typing: false })).toBe(true);
  });

  it('не идёт на скрытой вкладке', () => {
    expect(shouldRefresh({ hidden: true, busy: false, typing: false })).toBe(false);
  });

  /*
   * Своя операция уже меняет то же самое: обновление поверх неё
   * перерисует список дважды и вторым разом покажет состояние до
   * действия — оно успело уйти в запрос раньше.
   */
  it('не идёт поверх собственного действия', () => {
    expect(shouldRefresh({ hidden: false, busy: true, typing: false })).toBe(false);
  });

  it('откладывается, пока в форме набирают', () => {
    expect(shouldRefresh({ hidden: false, busy: false, typing: true })).toBe(false);
  });

  /*
   * Полминуты — верх для человека, который сидит и ждёт работу: минута
   * ожидания у пустого экрана читается как «заявок нет».
   */
  it('повторяется чаще, чем раз в полминуты', () => {
    expect(LIVE_REFRESH_MS).toBeGreaterThanOrEqual(20_000);
    expect(LIVE_REFRESH_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('чьё это событие', () => {
  it('чужая тема экран не будит', () => {
    expect(eventConcerns({ topic: 'exchange' }, { topic: 'conversations' })).toBe(false);
  });

  it('разговор слушает своего клиента, а не всех подряд', () => {
    const screen = { topic: 'conversations', clientId: '100' } as const;

    expect(eventConcerns({ topic: 'conversations', clientId: '100' }, screen)).toBe(true);
    expect(eventConcerns({ topic: 'conversations', clientId: '200' }, screen)).toBe(false);
  });

  it('список обращений слушает всех: он про всех и есть', () => {
    const screen = { topic: 'conversations' } as const;

    expect(eventConcerns({ topic: 'conversations', clientId: '200' }, screen)).toBe(true);
    expect(eventConcerns({ topic: 'conversations' }, screen)).toBe(true);
  });
});
