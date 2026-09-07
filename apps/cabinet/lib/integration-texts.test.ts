import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { loadApiDoc } from './openapi';
import { CALLS_HOW_TO, KEYS_HOW_TO, SANDBOX_HOW_TO, WEBHOOKS_HOW_TO } from './integration-texts';

/**
 * Подсказки кабинета и договор API читает мерчант, и машинный ритм в
 * них — тот же автоответчик, что в письме. Правило то же, что у
 * текстов бота (`bot-slop.ts`), и по той же причине оно тестом, а не
 * ревью: тексты правятся раз в полгода.
 */
describe('тексты интеграции набраны человеком', () => {
  it.each([
    ['API', KEYS_HOW_TO],
    ['Журнал вызовов', CALLS_HOW_TO],
    ['Песочница', SANDBOX_HOW_TO],
    ['Вебхуки', WEBHOOKS_HOW_TO],
  ] as const)('подсказка «%s»', (_name, items) => {
    for (const item of items) {
      expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
    }
  });

  it('описания в договоре API', () => {
    const doc = loadApiDoc();
    expect(slopComplaints(doc.intro)).toEqual([]);
    for (const operation of doc.operations) {
      const text = [operation.summary, operation.description ?? '']
        .concat(operation.responses.map((one) => one.description))
        .join('\n');
      expect(slopComplaints(text), `${operation.method} ${operation.path}`).toEqual([]);
    }
  });
});
