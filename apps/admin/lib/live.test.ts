import { describe, expect, it } from 'vitest';
import { eventConcerns, eventConcernsAny, rowsHaveUnsentText } from './live';

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

  /*
   * Карточка заявки с лентой переписки внутри — про заявку и про
   * разговор с её клиентом сразу: переход отмечает коллега, а чек
   * приходит в чат, и оба события должны будить один и тот же экран.
   * Соединение при этом одно: какие события его касаются, решает
   * список тем, а не вторая подписка.
   */
  it('карточка заявки с лентой слышит и переход, и своё сообщение', () => {
    const screens = [
      { topic: 'exchange' },
      { topic: 'conversations', clientId: '100' },
    ] as const;

    expect(eventConcernsAny({ topic: 'exchange' }, screens)).toBe(true);
    expect(eventConcernsAny({ topic: 'conversations', clientId: '100' }, screens)).toBe(true);
    expect(eventConcernsAny({ topic: 'conversations', clientId: '200' }, screens)).toBe(false);
  });
});

/**
 * Набрано ли в строках очереди то, что ещё не ушло.
 *
 * До 17 сентября 2026 очередь карт считала набором любое непустое поле
 * номера — и после того, как номер сохранился вместе с переходом, и после
 * того, как строка ушла из очереди. С первого же действия тихое
 * обновление вставало до перезагрузки.
 */
describe('набор в строках очереди', () => {
  it('номер, набранный поверх сохранённого, держит обновление', () => {
    expect(rowsHaveUnsentText({ a: 'PRV-42' }, [{ id: 'a', saved: null }])).toBe(true);
    expect(rowsHaveUnsentText({ a: 'PRV-43' }, [{ id: 'a', saved: 'PRV-42' }])).toBe(true);
  });

  it('сохранённый номер — уже не набор', () => {
    expect(rowsHaveUnsentText({ a: 'PRV-42' }, [{ id: 'a', saved: 'PRV-42' }])).toBe(false);
    expect(rowsHaveUnsentText({ a: ' PRV-42 ' }, [{ id: 'a', saved: 'PRV-42' }])).toBe(false);
  });

  it('строка ушла из очереди — ждать её поле незачем', () => {
    expect(rowsHaveUnsentText({ a: 'PRV-42' }, [{ id: 'b', saved: null }])).toBe(false);
  });

  it('пустое и нетронутое поле — не набор', () => {
    expect(rowsHaveUnsentText({ a: '  ' }, [{ id: 'a', saved: null }])).toBe(false);
    expect(rowsHaveUnsentText({}, [{ id: 'a', saved: 'PRV-42' }])).toBe(false);
  });
});
