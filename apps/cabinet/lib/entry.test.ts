import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { botLink, DOORS_PATH, entryDoors, entryRoute, wantsDoors } from './entry';

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

/**
 * Корень уводит вошедшего в его кабинет — туда ведут письма мерчанту, —
 * а двери по ссылке показываются всегда: на них выводят выход, знак на
 * экранах входа и кабинет амбассадора без входа. Без этого вошедший
 * мерчант не доходил до двери амбассадора, а вышедший амбассадор при
 * живой сессии мерчанта попадал в чужой кабинет.
 */
describe('корень витрины и двери по ссылке', () => {
  const nobody = { merchant: null, ambassador: null };

  it('без сессий корень показывает двери', () => {
    expect(entryRoute({ showDoors: false, ...nobody })).toEqual({
      kind: 'doors',
      signedIn: nobody,
    });
  });

  it('вошедшего мерчанта корень уводит в обзор — письма ведут на корень', () => {
    expect(entryRoute({ showDoors: false, merchant: 'Оплатишка', ambassador: null })).toEqual({
      kind: 'redirect',
      to: '/dashboard',
    });
  });

  it('вошедшего амбассадора корень уводит в его кабинет', () => {
    expect(
      entryRoute({ showDoors: false, merchant: null, ambassador: 'Пхукет за рубль' }),
    ).toEqual({ kind: 'redirect', to: '/ambassador' });
  });

  it('двери по ссылке не уводят и знают, кем вошли за каждой', () => {
    const both = { merchant: 'Оплатишка', ambassador: 'Пхукет за рубль' };
    expect(entryRoute({ showDoors: true, ...both })).toEqual({ kind: 'doors', signedIn: both });
  });

  it('двери просятся параметром без значения — таким адресом их и зовут', () => {
    expect(DOORS_PATH).toBe('/?doors');
    expect(wantsDoors({ doors: '' })).toBe(true);
    expect(wantsDoors({ doors: ['', ''] })).toBe(true);
    expect(wantsDoors({})).toBe(false);
    expect(wantsDoors({ doors: undefined })).toBe(false);
  });
});
