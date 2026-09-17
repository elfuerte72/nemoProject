import { describe, expect, it } from 'vitest';
import { navGroupsFor } from './nav-by-role';

/**
 * Что видно в меню, решает роль (тикет 17). Правило то же, что у ядра
 * (`merchantRoleCan` в `@nemo/types`), и проверяется тестом, потому
 * что глазами его не увидеть: разделы, которых у человека нет, на
 * экране просто отсутствуют — и отсутствуют они одинаково и когда
 * правило сработало, и когда меню собралось пустым по ошибке.
 */

/** Все адреса меню одной плоской строкой: так о них и спрашивают. */
function hrefs(role: 'owner' | 'operator' | 'viewer'): readonly string[] {
  return navGroupsFor(role).flatMap((group) => group.items.map((item) => item.href));
}

describe('меню по роли', () => {
  it('владелец видит всё, включая интеграцию и сотрудников', () => {
    const mine = hrefs('owner');
    expect(mine).toContain('/keys');
    expect(mine).toContain('/webhooks');
    expect(mine).toContain('/staff');
    expect(mine).toContain('/requests/new');
  });

  /**
   * Раздел, рассказывающий, как встроить то, к чему у человека нет
   * ключа, обещает больше, чем есть: группа «Интеграция» уходит
   * целиком.
   */
  it('оператор работает, но интеграции и людей не видит', () => {
    const mine = hrefs('operator');
    expect(mine).toContain('/requests/new');
    expect(mine).toContain('/recipients');
    expect(mine).toContain('/pos');
    expect(mine).not.toContain('/keys');
    expect(mine).not.toContain('/webhooks');
    expect(mine).not.toContain('/docs');
    expect(mine).not.toContain('/staff');
  });

  it('наблюдатель смотрит заявки и курсы, но не подаёт', () => {
    const mine = hrefs('viewer');
    expect(mine).toContain('/requests');
    expect(mine).toContain('/rates');
    expect(mine).toContain('/invoices');
    expect(mine).not.toContain('/requests/new');
    expect(mine).not.toContain('/recipients');
    expect(mine).not.toContain('/pos');
    expect(mine).not.toContain('/keys');
  });

  /** Настройки и поддержка — всем: свой пароль меняет каждый. */
  it('настройки и поддержка остаются у всех', () => {
    for (const role of ['owner', 'operator', 'viewer'] as const) {
      expect(hrefs(role)).toContain('/settings');
      expect(hrefs(role)).toContain('/support');
    }
  });

  /** Группа без пунктов не показывается: заголовок ни над чем — мусор. */
  it('пустых групп не отдаёт', () => {
    for (const role of ['owner', 'operator', 'viewer'] as const) {
      expect(navGroupsFor(role).every((group) => group.items.length > 0)).toBe(true);
    }
  });
});
