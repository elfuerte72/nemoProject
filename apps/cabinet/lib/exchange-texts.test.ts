import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { NEW_REQUEST_HOW_TO, RATES_HOW_TO, RECIPIENTS_HOW_TO } from './exchange-texts';

/**
 * Подсказки разделов обмена читает мерчант, и машинный ритм в них —
 * тот же автоответчик, что в письме. Правило то же, что у текстов бота
 * (`bot-slop.ts`), и по той же причине оно тестом, а не ревью: тексты
 * правятся раз в полгода.
 */
describe('тексты разделов обмена набраны человеком', () => {
  it.each([
    ['Новая заявка', NEW_REQUEST_HOW_TO],
    ['Получатели', RECIPIENTS_HOW_TO],
    ['Курсы', RATES_HOW_TO],
  ] as const)('подсказка «%s»', (_name, items) => {
    for (const item of items) {
      expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
    }
  });
});
