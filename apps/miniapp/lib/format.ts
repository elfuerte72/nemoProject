import { Money, readRate, sayRate } from '@nemo/types';

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
export const MAX_FRACTION_DIGITS = 8;

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

/**
 * Курс — всегда крупной стороной вперёд: «81 RUB за 1 USDT».
 *
 * Какая сторона называется и каким числом, решает `readRate` из
 * `@nemo/types`: это домен, и он один на клиента, панель и бота. Здесь
 * остаётся только вид числа — разряды и запятая.
 */
export function formatRate(rate: string, fromCode: string, toCode: string): string {
  return sayRate(Money.toAmount(rate), fromCode, toCode, formatAmount);
}

/**
 * Курс числом, крупной стороной, — без подписи пары.
 *
 * Подпись добавляет тот, кто показывает: в сообщении бота сторона одна
 * на весь столбец и написана в заголовке. Коды сюда поэтому и не
 * передаются — от них зависит только подпись, а число одно и то же.
 */
export function formatRateValue(value: string): string {
  return formatAmount(readRate(Money.toAmount(value), '', '').value);
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

/**
 * День, которым подписана группа в ленте истории.
 *
 * Свежие дни называются словом, а не числом: «сегодня» клиент читает
 * быстрее, чем сверяет «5 августа» с сегодняшней датой, — а ищет он в
 * ленте обычно именно вчерашнее.
 */
export function formatDay(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((midnight.getTime() - date.getTime()) / 86_400_000);

  if (days < 0) return 'Сегодня';
  if (days < 1) return 'Вчера';
  return formatDate(date);
}

/**
 * Месяцы в родительном падеже: подпись читается как «с марта 2026».
 *
 * Списком, а не через `Intl`: с одним лишь месяцем он даёт именительный
 * — «март 2026 г.», — и в предложении получается «с март 2026». Падеж
 * появляется только рядом с числом дня, а день здесь и не нужен.
 */
const MONTHS_OF = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/**
 * Месяц и год — так подписан стаж клиента в профиле. Дня там не нужно:
 * «с 14 марта 2026» читается как дата события, а событием регистрация
 * не была.
 */
export function formatMonth(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${MONTHS_OF[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Ставка в процентах: сервис хранит её целыми базисными пунктами.
 *
 * Своя, а не общая с панелью администратора: там это значение для поля
 * ввода — «2.5», — а здесь строка в предложении, где дробная часть
 * отделяется запятой и за числом стоит знак процента.
 */
export function formatBps(bps: number): string {
  const percent = Math.round(bps) / 100;
  return `${String(percent).replace('.', ',')}%`;
}

/** Короткий номер заявки: полный идентификатор клиенту не нужен. */
export function shortId(id: string): string {
  return `№ ${id.slice(0, 6)}`;
}
