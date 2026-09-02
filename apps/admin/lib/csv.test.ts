import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('выгрузка CSV', () => {
  it('точка с запятой внутри значения экранируется кавычками', () => {
    expect(csvCell('Клиент; передумал')).toBe('"Клиент; передумал"');
    expect(csvCell('сказал "нет"')).toBe('"сказал ""нет"""');
    expect(csvCell('просто')).toBe('просто');
    expect(csvCell(null)).toBe('');
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
