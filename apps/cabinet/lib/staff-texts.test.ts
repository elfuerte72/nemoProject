import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { ROLE_HINTS, STAFF_HOW_TO } from './staff-texts';

/**
 * Подсказку раздела читает владелец кабинета, решая, кому что открыть.
 * Правило то же, что у текстов бота, и тестом по той же причине:
 * правятся они раз в полгода, и замечание из прошлого ревью к этому
 * сроку помнит только тот, кто его делал.
 */
describe('тексты раздела «Сотрудники» набраны человеком', () => {
  it('подсказка «как устроено»', () => {
    for (const item of STAFF_HOW_TO) {
      expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
    }
  });

  it('пояснения к ролям', () => {
    for (const hint of Object.values(ROLE_HINTS)) {
      expect(slopComplaints(hint)).toEqual([]);
    }
  });
});
