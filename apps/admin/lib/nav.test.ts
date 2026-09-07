import { describe, expect, it } from 'vitest';
import { isCurrentSection } from '@nemo/ui/nav';
import { NAV_GROUPS, SETTINGS_SECTIONS } from './nav';

/**
 * Карта разделов панели. Общие правила меню — свёртка групп и то, какой
 * раздел считать текущим, — живут в `@nemo/ui` и покрыты там: кабинет
 * мерчанта пользуется теми же.
 */

describe('карта разделов', () => {
  /*
   * Ключ группы — то, по чему её помнят свёрнутой: повторившись, он
   * свернул бы две группы одним нажатием.
   */
  it('ключи групп не повторяются', () => {
    const keys = NAV_GROUPS.map((group) => group.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('подразделы настроек', () => {
  it('лежат под разделом настроек: меню подсвечивает его на любом из них', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(isCurrentSection('/settings', section.href)).toBe(true);
    }
  });

  it('адреса не повторяются', () => {
    const hrefs = SETTINGS_SECTIONS.map((section) => section.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

/**
 * Мерчанты — раздел работы, а не администратора: менеджер ведёт их
 * заявки и должен видеть, с кем имеет дело. Кнопки решений при этом
 * только у администратора, и отказывает им сама операция.
 */
describe('раздел «Мерчанты»', () => {
  it('стоит в основном ряду и считает ждущих рассмотрения', () => {
    const item = NAV_GROUPS.flatMap((group) => group.items).find(
      (one) => one.href === '/merchants',
    );
    expect(item).toMatchObject({ label: 'Мерчанты', count: 'merchants' });
  });

  it('карточка мерчанта подсвечивает свой раздел', () => {
    expect(isCurrentSection('/merchants', '/merchants/9d2a')).toBe(true);
    // И не подсвечивает соседний: обмен начинается с корня, и без этой
    // проверки «/merchants» подсветило бы стол.
    expect(isCurrentSection('/', '/merchants')).toBe(false);
  });

  it('у мерчантов есть свой подраздел настроек', () => {
    expect(SETTINGS_SECTIONS.some((one) => one.href === '/settings/merchants')).toBe(true);
  });
});
