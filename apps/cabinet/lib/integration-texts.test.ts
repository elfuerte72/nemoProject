import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { loadApiDoc } from './openapi';
import { CALLS_HOW_TO, KEYS_HOW_TO, SANDBOX_HOW_TO, WEBHOOKS_HOW_TO } from './integration-texts';
import { SESSIONS_HOW_TO } from './security-texts';
import { V1_ERRORS, V1_RESPONSE_HEADERS } from './v1/reference';

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
    ['Сессии', SESSIONS_HOW_TO],
  ] as const)('подсказка «%s»', (_name, items) => {
    for (const item of items) {
      expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
    }
  });

  it('справка по кодам ошибок и заголовкам', () => {
    for (const [code, one] of Object.entries(V1_ERRORS)) {
      expect(slopComplaints(`${one.meaning}\n${one.action}`), code).toEqual([]);
    }
    for (const header of V1_RESPONSE_HEADERS) {
      expect(slopComplaints(header.meaning), header.name).toEqual([]);
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
