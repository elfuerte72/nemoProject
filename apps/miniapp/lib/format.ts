/**
 * Числа и даты в том виде, в каком их читает клиент.
 *
 * Суммы приходят из ядра десятичными строками произвольной точности:
 * `Number` их портит, а `toLocaleString` требует именно его. Поэтому
 * группировка сделана руками — строка разбирается на части, и ни одна
 * цифра по дороге не теряется.
 */

/**
 * Разряды разделяет узкий неразрывный пробел: обычный шире, чем нужно
 * между цифрами, а разрывный переносит половину суммы на следующую
 * строку.
 */
const GROUP_SEPARATOR = '\u202F';

/**
 * Сколько знаков после запятой показывать. Больше восьми не показывает
 * никто: хранение допускает восемнадцать, но такой хвост — свойство
 * арифметики, а не сумма, которую человек различает.
 */
const MAX_FRACTION_DIGITS = 8;

/** Сумма для показа: `1234.5000` → `1 234,5`, `100.000000` → `100`. */
export function formatAmount(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  const tail = fraction.slice(0, MAX_FRACTION_DIGITS).replace(/0+$/, '');

  return `${negative ? '−' : ''}${grouped}${tail ? `,${tail}` : ''}`;
}

/** Что человек мог ввести и что при этом означает число. */
const TYPED_AMOUNT = /^\d+([.,]\d*)?$/;

/**
 * Обратное к `formatAmount`: введённое человеком — в десятичную строку
 * для сервера. Разряды он разделяет пробелом, дробную часть — запятой,
 * и ни того, ни другого сервер не принимает.
 */
export function parseAmount(input: string): string {
  return input.replace(/\s/g, '').replace(',', '.');
}

/**
 * Привести введённое к виду с разрядами — но только если введено
 * число. Мусор остаётся как есть: подменять его на «0» значило бы
 * стереть опечатку вместе с тем, что человек хотел набрать.
 */
export function normalizeTyped(input: string): string {
  const cleaned = input.replace(/\s/g, '');
  return TYPED_AMOUNT.test(cleaned) ? formatAmount(cleaned.replace(',', '.')) : input;
}

/** Сумма с кодом валюты — так, как она читается вслух. */
export function formatMoney(value: string, code: string): string {
  return `${formatAmount(value)} ${code}`;
}

/** Курс: `1 RUB ≈ 0,0106 USDT`. */
export function formatRate(rate: string, fromCode: string, toCode: string): string {
  return `1 ${fromCode} ≈ ${formatAmount(rate)} ${toCode}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

/**
 * Дата без года: заявки живут днями, и год в списке из трёх строк —
 * шум. Для прошлогодних он возвращается: «28 июля» без года там врёт.
 */
export function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return sameYear
    ? DATE_FORMAT.format(date)
    : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Короткий номер заявки: полный идентификатор клиенту не нужен. */
export function shortId(id: string): string {
  return `№ ${id.slice(0, 6)}`;
}
