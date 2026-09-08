import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { CLIENT_REFERRAL_HOW_TO, REFERRAL_PROGRAM_HOW_TO } from './referral-texts';

/**
 * Подсказки о реферальной программе читает администратор, и машинный
 * ритм в них — тот же, что в тексте бота. Правило тестом, а не ревью:
 * тексты правятся раз в полгода.
 */
describe('тексты реферальной программы набраны человеком', () => {
  it.each([
    ['Рефералка в настройках', REFERRAL_PROGRAM_HOW_TO],
    ['Рефералка в карточке клиента', CLIENT_REFERRAL_HOW_TO],
  ] as const)('подсказка «%s»', (_name, items) => {
    for (const item of items) {
      expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
    }
  });
});
