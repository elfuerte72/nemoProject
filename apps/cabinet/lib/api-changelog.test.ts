import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { API_CHANGES, CHANGELOG_HOW_TO, changeDate } from './api-changelog';

/**
 * «Изменения API» читает разработчик мерчанта, решая, трогать ли свой
 * код. Проверяется то, что глазом легко пропустить: порядок записей,
 * настоящие даты и машинный ритм в словах.
 */
describe('изменения API', () => {
  it('записи — новыми сверху, у каждой настоящая дата', () => {
    const dates = API_CHANGES.map((change) => change.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const date of dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(date))).toBe(false);
    }
  });

  it('у каждой записи сказано, что делать интеграции', () => {
    for (const change of API_CHANGES) {
      expect(change.items.length, change.title).toBeGreaterThan(0);
      expect(change.action.trim(), change.title).not.toBe('');
    }
  });

  it('дата — словами, без «г.»', () => {
    expect(changeDate('2026-09-07')).toBe('7 сентября 2026');
    expect(changeDate('2026-01-31')).toBe('31 января 2026');
  });

  it('тексты набраны человеком', () => {
    for (const item of CHANGELOG_HOW_TO) {
      expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
    }
    for (const change of API_CHANGES) {
      const text = [change.title, ...change.items, change.action].join('\n');
      expect(slopComplaints(text), change.title).toEqual([]);
    }
  });
});
