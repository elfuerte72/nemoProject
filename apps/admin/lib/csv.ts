/**
 * CSV для Excel и Numbers без настройки.
 *
 * Разделитель — точка с запятой: русская локаль Excel ждёт её, а
 * запятая у неё десятичная. В начале — метка порядка байтов, иначе
 * Excel читает кириллицу как кракозябры. Значение с разделителем,
 * кавычкой или переносом берётся в кавычки, кавычка внутри удваивается.
 */
export const CSV_SEPARATOR = ';';

export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return '﻿' + rows.map((row) => row.map(csvCell).join(CSV_SEPARATOR)).join('\r\n') + '\r\n';
}
