import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Ошибки ядра узнаются по коду, а не по классу.
 *
 * Ядро кабинета заводит хук запуска в своём бандле, и ошибка приходит в
 * маршрут с классом из другой копии `@nemo/core`: `instanceof` ложно, и
 * ломается это молча — ответ тот же, не срабатывает только то, что
 * стояло за условием. 14 сентября 2026 так не работал предел попыток
 * входа. Узнаёт ошибку `isCoreError` из `@nemo/http`.
 */

const ROOT = join(__dirname, '..');
const CORE_ERRORS =
  /instanceof\s+(CoreError|NotFoundError|ForbiddenError|InvalidInputError|TransitionNotAllowedError|ConflictError|UnavailableError)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' || name === '.next' ? [] : sources(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Код без комментариев: объяснение ловушки словами — не сама ловушка. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('ошибки ядра в кабинете', () => {
  it('нигде не сравниваются через instanceof', () => {
    const offenders = [...sources(join(ROOT, 'app')), ...sources(join(ROOT, 'lib'))]
      .filter((path) => CORE_ERRORS.test(codeOf(path)))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});
