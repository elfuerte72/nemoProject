import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { botLink, entryDoors } from './entry';

/**
 * Витрина без настроенного виджета показывает вход мерчанта и говорит
 * словами, что вход амбассадора не готов: молчащая кнопка хуже
 * отсутствующей — нажавший решает, что сломан он.
 */
describe('двери витрины', () => {
  it('с именем бота и токеном показывает кнопку', () => {
    const doors = entryDoors({ botUsername: '@tobee_bot', botTokenSet: true });
    expect(doors).toEqual({ botUsername: 'tobee_bot', ambassadorNote: null });
    expect(botLink(doors.botUsername)).toBe('https://t.me/tobee_bot');
  });

  it('без токена кнопки нет, даже если имя задано: подпись проверять нечем', () => {
    const doors = entryDoors({ botUsername: 'tobee_bot', botTokenSet: false });
    expect(doors.botUsername).toBeNull();
    expect(doors.ambassadorNote).toMatch(/не настроен/i);
  });

  it('без имени бота — то же самое, и пустая строка именем не считается', () => {
    expect(entryDoors({ botUsername: undefined, botTokenSet: true }).botUsername).toBeNull();
    expect(entryDoors({ botUsername: '   ', botTokenSet: true }).botUsername).toBeNull();
    expect(botLink(null)).toBeNull();
  });

  it('слова об этом набраны человеком', () => {
    const note = entryDoors({ botUsername: undefined, botTokenSet: false }).ambassadorNote;
    expect(slopComplaints(note ?? '')).toEqual([]);
  });
});
