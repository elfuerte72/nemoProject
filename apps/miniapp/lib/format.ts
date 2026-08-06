import { Money, type RequisiteKind } from '@nemo/types';

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
 * Направление обмена на чтение курса влиять не должно. «1 RUB ≈ 0,0122
 * USDT» формально то же самое, но числом в сотых долях никто не
 * пользуется и с курсом соседнего обменника его не сравнить, не
 * перевернув в уме. Поэтому мелкая сторона переворачивается, и курс
 * читается так же, как на любом табло.
 */
export function formatRate(rate: string, fromCode: string, toCode: string): string {
  const value = Money.toAmount(rate);
  const big = Money.compare(value, Money.toAmount('1')) >= 0;
  return `${formatRateValue(rate)} ${big ? toCode : fromCode} за 1 ${big ? fromCode : toCode}`;
}

/**
 * Курс числом, крупной стороной.
 *
 * Целое здесь не округление для вида: курс округляется в ядре и целым
 * же считается, поэтому сумма к выдаче сходится с показанным курсом
 * устно. Дробный хвост может появиться только один — от переворота
 * мелкой стороны, — и он остаток ограниченной точности, а не цена.
 * Снимается он округлением к ближайшему: отброшенный вниз, он превратил
 * бы 82 в 81.
 */
export function formatRateValue(value: string): string {
  const amount = Money.toAmount(value);
  const one = Money.toAmount('1');
  // Переворачивать нечего и незачем: делить на ноль нельзя, а такой
  // курс может прийти из старой заявки.
  if (Money.isZero(amount) || Money.isNegative(amount)) return formatAmount(amount);
  return formatAmount(
    Money.round(Money.compare(amount, one) >= 0 ? amount : Money.divide(one, amount)),
  );
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
