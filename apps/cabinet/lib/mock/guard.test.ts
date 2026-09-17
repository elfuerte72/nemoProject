import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isCoreError } from '@nemo/http';
import { describe, expect, it } from 'vitest';
import { requireTill } from './guard';

/**
 * POS-терминал, счета и возвраты — право `till` из той же таблицы
 * ролей, что у ядра (`merchantRoleCan`).
 *
 * 14 сентября 2026 на dev наблюдатель, которому страница `/pos` отвечает
 * «Этот раздел не ваш», создал счёт прямым запросом — 201: маршруты
 * макета проверяли только, что кабинет активен.
 */

function codeOf(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return isCoreError(error) ? error.code : 'не ошибка ядра';
  }
}

describe('кто работает в POS-терминале', () => {
  it('владелец и оператор активного кабинета — да', () => {
    expect(codeOf(() => requireTill({ role: 'owner', status: 'active' }))).toBeNull();
    expect(codeOf(() => requireTill({ role: 'operator', status: 'active' }))).toBeNull();
  });

  it('наблюдатель — нет, и это отказ права, а не состояния', () => {
    expect(codeOf(() => requireTill({ role: 'viewer', status: 'active' }))).toBe('forbidden');
  });

  it('неактивный кабинет — нет даже владельцу', () => {
    expect(codeOf(() => requireTill({ role: 'owner', status: 'pending' }))).toBe('invalid-input');
    expect(codeOf(() => requireTill({ role: 'operator', status: 'disabled' }))).toBe('invalid-input');
  });
});

describe('маршруты POS-терминала', () => {
  const API = join(__dirname, '..', '..', 'app', 'api', 'pos');

  function routes(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? routes(path) : name === 'route.ts' ? [path] : [];
    });
  }

  const changing = routes(API).filter((path) =>
    /export async function (POST|PUT|PATCH|DELETE)\b/.test(readFileSync(path, 'utf8')),
  );

  it('изменяющих маршрутов несколько', () => {
    expect(changing.length).toBeGreaterThanOrEqual(3);
  });

  it.each(changing.map((path) => [relative(API, path), path]))(
    '%s спрашивает право до записи',
    (_name, path) => {
      expect(readFileSync(path, 'utf8')).toContain('requireTill(session)');
    },
  );
});
