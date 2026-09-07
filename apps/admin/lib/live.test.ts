import { describe, expect, it } from 'vitest';
import { eventConcerns } from './live';

/**
 * Чьё это событие. Общее правило тихого обновления — в `@nemo/ui` и
 * покрыто там: его делит с панелью кабинет мерчанта. Здесь остаётся
 * своё — толчок от сервера, которого у кабинета нет.
 */

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
