import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Цель нажатия в режиме кассы.
 *
 * Вёрстку тестами не проверяют — размер и цвет смотрятся глазами, — но
 * это тот случай, о котором `CLAUDE.md` говорит отдельно: цель нажатия
 * под палец глазом не измеришь. У стойки промах стоит второго набора
 * суммы при покупателе, а сорок восемь точек — предел, ниже которого
 * промахиваются.
 *
 * Читается сам файл оформления: правило живёт в нём, и проверять надо
 * его, а не пересказ в коде.
 */

const css = readFileSync(
  fileURLToPath(new URL('../app/globals.css', import.meta.url)),
  'utf8',
);

/** `min-height` правила по имени класса, в точках. */
function minHeightOf(selector: string): number | null {
  const block = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 'u').exec(css);
  const found = block?.[1] ? /min-height:\s*(\d+)px/u.exec(block[1]) : null;
  return found?.[1] ? Number(found[1]) : null;
}

describe('режим кассы', () => {
  it('клавиша набора не мельче сорока восьми точек', () => {
    const height = minHeightOf('desk__key');
    expect(height).not.toBeNull();
    expect(height!).toBeGreaterThanOrEqual(48);
  });

  it('кнопка «Выставить счёт» в режиме кассы тоже под палец', () => {
    const height = minHeightOf('btn--wide');
    expect(height).not.toBeNull();
    expect(height!).toBeGreaterThanOrEqual(48);
  });
});
