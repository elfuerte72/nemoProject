import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv.js';

describe('выгрузка CSV', () => {
  it('точка с запятой внутри значения экранируется кавычками', () => {
    expect(csvCell('Клиент; передумал')).toBe('"Клиент; передумал"');
    expect(csvCell('сказал "нет"')).toBe('"сказал ""нет"""');
    expect(csvCell('просто')).toBe('просто');
    expect(csvCell(null)).toBe('');
  });

  /*
   * Ячейка, начатая знаком формулы, Excel исполняет — и в кавычках тоже.
   * В файл уходит набранное снаружи: `reference` заявки из API,
   * назначение и покупатель счёта, имя клиента в выгрузке панели. Разбор
   * безопасности 14 сентября 2026: `=2+5` и `=HYPERLINK(…)` уходили как
   * есть. Апостроф впереди — правило OWASP: Excel читает ячейку текстом.
   */
  it('ячейка, начатая знаком формулы, читается текстом', () => {
    expect(csvCell('=2+5')).toBe("'=2+5");
    expect(csvCell('@SUM(1,2)')).toBe("'@SUM(1,2)");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvCell('\t=1')).toBe("'\t=1");
    expect(csvCell('=HYPERLINK("https://evil.example";"Открыть")')).toBe(
      '"\'=HYPERLINK(""https://evil.example"";""Открыть"")"',
    );
  });

  it('числа и телефоны со знаком остаются числами: формулу из цифр не собрать', () => {
    expect(csvCell('-500')).toBe('-500');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('+7 999 100-10-10')).toBe('+7 999 100-10-10');
  });

  it('файл начинается с метки порядка байтов и разделён точкой с запятой', () => {
    const csv = toCsv([
      ['День', 'Подано'],
      ['2026-09-02', 3],
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('День;Подано\r\n2026-09-02;3\r\n');
  });
});
