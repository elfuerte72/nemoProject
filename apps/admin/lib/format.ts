/**
 * Суммы для человека.
 *
 * Своя копия, а не общий с клиентом модуль: у клиентского приложения
 * форматов десяток — даты, курсы, ввод с клавиатуры телефона, — и общим
 * оказался бы ровно этот десяток, чтобы админка использовала один. Пока
 * функция одна, копия дешевле пакета; отметка об этом — в `backlog.md`.
 *
 * Разряды обязательны: очередь читают глазами, и «5400000» от «540000»
 * без пробелов отличается только длиной.
 */

const GROUP_SEPARATOR = ' ';

/**
 * Цифры не додумываются и не округляются: сумма приходит строкой
 * `numeric(38, 18)`, и подтянутая вверх копейка — это чужие деньги.
 * Хвост из нулей убирается, значащие знаки остаются все.
 */
export function formatAmount(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  const tail = fraction.replace(/0+$/, '');

  return `${negative ? '−' : ''}${grouped}${tail ? `,${tail}` : ''}`;
}

/** Сумма с кодом валюты — так, как она читается вслух. */
export function formatMoney(value: string, code: string): string {
  return `${formatAmount(value)} ${code}`;
}
