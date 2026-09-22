import { describe, expect, it } from 'vitest';
import {
  currentSection,
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

  /**
   * У кабинета мерчанта «Новая заявка» живёт под «Заявками» — по
   * адресу и по смыслу. Текущий среди совпавших — самый длинный:
   * иначе на странице новой заявки подсвечивались бы оба пункта, и
   * «где я» читалось бы как «в двух местах сразу».
   */
  it('среди вложенных разделов текущий — самый длинный совпавший', () => {
    const items = [{ href: '/' }, { href: '/requests' }, { href: '/requests/new' }];
    expect(currentSection(items, '/requests/new')).toBe('/requests/new');
    expect(currentSection(items, '/requests/abc-123')).toBe('/requests');
    expect(currentSection(items, '/')).toBe('/');
    expect(currentSection(items, '/rates')).toBeUndefined();
  });
});

/*
 * Раздел без своего пункта в меню — не редкость: аналитику мерчанта
 * владелец просил не выносить отдельной строкой, входят в неё с обзора
 * кнопкой «Подробнее». Но пока человек там, меню не подсвечивало
 * ничего, и раздел читался как место вне кабинета.
 *
 * Правило проверяется тестом: на экране видно одно состояние, а неверно
 * оно ровно там, где человек уже ушёл со своей страницы.
 */
describe('раздел без своего пункта', () => {
  const items = [
    { href: '/dashboard', owns: ['/analytics'] },
    { href: '/requests' },
    { href: '/rates' },
  ];

  it('подсвечивает владельца, когда человек в его разделе', () => {
    expect(currentSection(items, '/analytics')).toBe('/dashboard');
  });

  it('и на вложенном адресе того же раздела', () => {
    expect(currentSection(items, '/analytics/cuts')).toBe('/dashboard');
  });

  it('свой адрес по-прежнему точнее чужого', () => {
    expect(currentSection(items, '/requests')).toBe('/requests');
  });

  it('чужой раздел, которым никто не владеет, не подсвечивает никого', () => {
    expect(currentSection(items, '/support')).toBeUndefined();
  });
});
