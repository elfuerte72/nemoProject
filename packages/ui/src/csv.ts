/**
 * CSV для Excel и Numbers без настройки.
 *
 * Разделитель — точка с запятой: русская локаль Excel ждёт её, а
 * запятая у неё десятичная. В начале — метка порядка байтов, иначе
 * Excel читает кириллицу как кракозябры. Значение с разделителем,
 * кавычкой или переносом берётся в кавычки, кавычка внутри удваивается.
 */
export const CSV_SEPARATOR = ';';

/**
 * Знак, с которого Excel начинает формулу. Исполняет он её и в кавычках,
 * а в выгрузку уходит набранное снаружи — `reference` заявки из API,
 * назначение счёта, имя клиента. Такая ячейка получает апостроф впереди
 * (правило OWASP), и Excel читает её текстом.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Число или телефон со знаком — не формула: из цифр, пробелов, точек,
 * скобок и дефисов ни ссылки, ни вызова не собрать, а апостроф перед
 * «-500» превратил бы сумму в текст, который Excel не сложит.
 */
const SIGNED_NUMBER = /^[+-]?[\d\s.,()-]+$/;

export function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const text = FORMULA_START.test(raw) && !SIGNED_NUMBER.test(raw) ? `'${raw}` : raw;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return '﻿' + rows.map((row) => row.map(csvCell).join(CSV_SEPARATOR)).join('\r\n') + '\r\n';
}
