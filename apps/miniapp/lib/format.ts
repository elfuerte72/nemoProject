import type { RequisiteKind } from '@nemo/types';

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

/**
 * Курс на табло: чем крупнее число, тем меньше смысла в его дробной
 * части. Пять миллионов рублей за биткойн с копейками читаются хуже, чем
 * без них; у дешёвых монет, наоборот, вся цена в долях единицы.
 *
 * Лишние знаки отбрасываются, а не округляются: курс справочный
 * (docs/adr/0004), и подтянутая вверх цифра обещала бы точность, которой
 * здесь нет.
 */
export function formatRateValue(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const digits = whole.replace('-', '').length >= 4 ? 0 : whole === '0' ? 8 : 2;
  return formatAmount(digits === 0 ? whole : `${whole}.${fraction.slice(0, digits)}`);
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

/**
 * Реквизиты одной строкой: банк и телефон, банк и последние цифры карты,
 * сеть и края адреса. По этой подписи клиент узнаёт свою запись, не видя
 * её целиком — полное значение расшифровывает только админ-панель
 * (docs/adr/0002).
 *
 * Своя, а не общая с ядром: у ядра такая же подпись есть — ею
 * называется открытый реквизит в журнале доступа, — но ядро тянет за
 * собой драйвер базы, и импорт из него в экране увёз бы её в браузер.
 * Совпадать эти две подписи должны, и расходятся они заметно: в
 * приложении и в панели один реквизит назывался бы по-разному.
 */
export function describeRequisites(requisites: {
  kind: RequisiteKind;
  bankName: string | null;
  phone: string | null;
  cardLast4: string | null;
  network: string | null;
  addressHint: string | null;
}): string {
  switch (requisites.kind) {
    case 'phone':
      return [requisites.bankName, requisites.phone].filter(Boolean).join(' · ');
    case 'card':
      return [requisites.bankName, `карта •••• ${requisites.cardLast4 ?? ''}`.trim()]
        .filter(Boolean)
        .join(' · ');
    case 'wallet':
      return [requisites.network, requisites.addressHint].filter(Boolean).join(' · ');
  }
}
