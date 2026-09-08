import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import {
  allReferralsButton,
  nextTierNote,
  pendingNote,
  plural,
  previousNote,
  REFERRAL_TEXTS,
  referralRowSub,
} from './referral-texts';

/** Подписи кабинета читает клиент — правило то же, что у текстов бота. */
describe('тексты реферального кабинета набраны человеком', () => {
  it.each(Object.entries(REFERRAL_TEXTS))('«%s»', (_key, text) => {
    expect(slopComplaints(text)).toEqual([]);
  });

  it.each([
    ['уровень', nextTierNote('Золото', 4, 6)],
    ['уровень без активных', nextTierNote('Серебро', 1, 0)],
    ['прошлый период', previousNote('410')],
    ['ждёт выплаты', pendingNote('500')],
    ['все рефералы', allReferralsButton(21)],
    ['строка реферала', referralRowSub({ line: 2, since: '6 сентября', completedCount: 3, last: 'сегодня' })],
    ['строка без обменов', referralRowSub({ line: 1, since: 'вчера', completedCount: 0, last: null })],
  ])('образец «%s»', (_name, text) => {
    expect(slopComplaints(text)).toEqual([]);
  });

  it('склоняет по числу', () => {
    expect(nextTierNote('Золото', 1, 0)).toContain('1 активный реферал');
    expect(nextTierNote('Золото', 3, 2)).toContain('3 активных реферала, сейчас 2');
    expect(plural(21, ['обмен', 'обмена', 'обменов'])).toBe('обмен');
    expect(plural(12, ['обмен', 'обмена', 'обменов'])).toBe('обменов');
  });
});
