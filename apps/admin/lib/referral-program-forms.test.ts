import { describe, expect, it } from 'vitest';
import {
  draftsToLines,
  individualDraftsToRates,
  linesToDrafts,
  tierDraftToInput,
} from './referral-program-forms';

/**
 * Черновики форм реферальной программы: проценты на экране, базисные
 * пункты в ядре, пустое поле — «наследует», а не ноль. Кнопка гаснет по
 * этим же правилам до отправки: отказ ядра после нажатия говорил бы о
 * поле, в котором опечатка, а администратор видит его перед собой.
 */
describe('линии', () => {
  it('идут из программы процентами и возвращаются базисными пунктами по порядку', () => {
    const drafts = linesToDrafts([
      { line: 1, rateBps: 500 },
      { line: 2, rateBps: 250 },
    ]);
    expect(drafts).toEqual(['5', '2.5']);
    expect(draftsToLines(drafts)).toEqual([
      { line: 1, rateBps: 500 },
      { line: 2, rateBps: 250 },
    ]);
  });

  it('пустая, нечисловая или шестая линия — не отправляются', () => {
    expect(draftsToLines([])).toBeNull();
    expect(draftsToLines(['5', ''])).toBeNull();
    expect(draftsToLines(['5', 'два'])).toBeNull();
    expect(draftsToLines(['1', '1', '1', '1', '1', '1'])).toBeNull();
  });
});

describe('уровень', () => {
  it('порог целый от одного, ставки — только заполненные линии', () => {
    expect(
      tierDraftToInput({ id: 't1', name: ' Серебро ', threshold: '3', rates: ['8', '', '1'] }),
    ).toEqual({
      id: 't1',
      name: 'Серебро',
      minActiveReferrals: 3,
      rates: [
        { line: 1, rateBps: 800 },
        { line: 3, rateBps: 100 },
      ],
    });
    expect(tierDraftToInput({ name: '', threshold: '3', rates: [] })).toBeNull();
    expect(tierDraftToInput({ name: 'А', threshold: '0', rates: [] })).toBeNull();
    expect(tierDraftToInput({ name: 'А', threshold: '2,5', rates: [] })).toBeNull();
    expect(tierDraftToInput({ name: 'А', threshold: '2', rates: ['x'] })).toBeNull();
  });
});

describe('личные ставки', () => {
  it('пустые поля — снять все, заполненные — по линиям', () => {
    expect(individualDraftsToRates(['', ''])).toBeNull();
    expect(individualDraftsToRates(['10', ''])).toEqual([{ line: 1, rateBps: 1000 }]);
    expect(individualDraftsToRates(['10', 'x'])).toBeUndefined();
  });
});
