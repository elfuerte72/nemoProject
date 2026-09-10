import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import {
  AMBASSADOR_LINK_HOW_TO,
  AMBASSADOR_OVERVIEW_HOW_TO,
  AMBASSADOR_PEOPLE_HOW_TO,
  AMBASSADOR_SERVICES_HOW_TO,
  AMBASSADOR_WITHDRAWAL_HOW_TO,
} from './ambassador-texts';

/**
 * Подсказки кабинета читает амбассадор — человек с аудиторией, который
 * машинный текст узнаёт с первой строки. Правило то же, что у текстов
 * бота, и тестом по той же причине: правятся они раз в полгода.
 */
describe('подсказки кабинета амбассадора набраны человеком', () => {
  it.each([
    ['Обзор', AMBASSADOR_OVERVIEW_HOW_TO],
    ['Мои люди', AMBASSADOR_PEOPLE_HOW_TO],
    ['Услуги', AMBASSADOR_SERVICES_HOW_TO],
    ['Ссылка', AMBASSADOR_LINK_HOW_TO],
    ['Вывод', AMBASSADOR_WITHDRAWAL_HOW_TO],
  ] as const)('подсказка «%s»', (_name, items) => {
    for (const item of items) {
      expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
    }
  });
});
