import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abilityForPath } from './nav-by-role';
import { NAV_GROUPS } from './nav';

/**
 * Раздел, закрытый ролью, обязан сам об этом знать (тикет 17).
 *
 * Пункт, спрятанный из меню, никого не останавливает: адрес присылают в
 * переписке, он остаётся в закладках, — и страница, открытая прямой
 * ссылкой, доходила до операции и падала её отказом. Человек видел
 * пятисотый ответ там, где правило хотело сказать «это может только
 * владелец»; поймано живой проверкой 12 сентября 2026.
 *
 * Тест по файлам, потому что забывается это молча: новый раздел
 * заводится строкой в `NAV_GROUPS`, а охрану в него дописать забывают —
 * и узнают об этом от того, кто прошёл по ссылке.
 */

const CABINET = join(__dirname, '..', 'app', '(cabinet)');

/** Страница раздела по его адресу: `/webhooks/guide` → `webhooks/guide/page.tsx`. */
function pageOf(path: string): string {
  return join(CABINET, path.replace(/^\//, ''), 'page.tsx');
}

const GUARDED = NAV_GROUPS.flatMap((group) => group.items)
  .map((item) => item.href)
  .filter((href) => abilityForPath(href) !== undefined);

describe('закрытые роли разделы отказывают словами', () => {
  it('закрытых разделов в меню несколько', () => {
    expect(GUARDED.length).toBeGreaterThan(5);
  });

  it.each(GUARDED)('%s спрашивает право до операции', (href) => {
    const source = readFileSync(pageOf(href), 'utf8');
    expect(source).toContain(`allowedHere('${href}')`);
    expect(source).toContain('NoAccess');
  });
});
