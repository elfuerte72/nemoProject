import { describe, expect, it } from 'vitest';
import {
  isCurrentSection,
  parseCollapsed,
  serializeCollapsed,
  toggleCollapsed,
} from './nav.js';

/**
 * Память о свёрнутых группах меню.
 *
 * Хранится в браузере строкой, и строку эту никто не охраняет: её
 * может испортить расширение, чужая версия панели или рука. Меню при
 * этом обязано открыться — с испорченной записью так, будто её нет.
 */

describe('свёрнутые группы меню', () => {
  it('переживают запись и чтение', () => {
    const collapsed = toggleCollapsed(new Set(), 'admin');
    expect([...parseCollapsed(serializeCollapsed(collapsed))]).toEqual(['admin']);
  });

  it('повторная свёртка разворачивает', () => {
    const once = toggleCollapsed(new Set(), 'admin');
    expect(toggleCollapsed(once, 'admin').size).toBe(0);
  });

  it('испорченная запись читается как пустая', () => {
    expect(parseCollapsed('{not json').size).toBe(0);
    expect(parseCollapsed('"admin"').size).toBe(0);
    expect(parseCollapsed('[1, null, "admin"]').size).toBe(1);
    expect(parseCollapsed(null).size).toBe(0);
  });
});

describe('текущий раздел', () => {
  it('корень отмечается только на самом корне', () => {
    expect(isCurrentSection('/', '/')).toBe(true);
    expect(isCurrentSection('/', '/withdrawals')).toBe(false);
  });

  it('вложенная страница принадлежит своему разделу', () => {
    expect(isCurrentSection('/conversations', '/conversations/123')).toBe(true);
  });
});
