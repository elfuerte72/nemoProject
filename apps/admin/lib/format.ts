import { Money, sayRate } from '@nemo/types';

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

/**
 * Курс — той же формулировкой, что видит клиент: «81 RUB за 1 USDT».
 *
 * Голым числом он не читается: «Курс сделки: 81» заставляет менеджера
 * догадываться, что означает восемьдесят один, а перевёрнутый курс
 * валют выдачи — доллара, евро — не опознаётся вовсе. Менеджер сверяет
 * своё число с тем, которое видел клиент, и называть его надо так же.
 *
 * Какая сторона называется, каким числом и какими словами, решает
 * `sayRate` из `@nemo/types` — одно правило на панель, приложение и
 * бота. Здесь остаётся только вид числа: панель показывает все значащие
 * знаки, клиент обрезает хвост на восьмом.
 */
export function formatRate(rate: string, fromCode: string, toCode: string): string {
  return sayRate(Money.toAmount(rate), fromCode, toCode, formatAmount);
}

/**
 * Когда это было — так, как о времени говорят.
 *
 * Очередь читают сверху вниз и в первую очередь ищут сегодняшнее:
 * «03.08.2026, 05:45:46» отвечает на вопрос «какого числа», а менеджер
 * спрашивает «давно ли». Поэтому сегодняшнее — время, вчерашнее —
 * словом, остальное — датой; год добавляется, только если он не этот.
 *
 * Часовой пояс передаётся явно: панель рисуется на сервере, а сервер
 * живёт в UTC, и без него менеджеру показывалось бы время, которого на
 * его часах не было.
 */
export function formatMoment(value: Date, now: Date, timeZone: string): string {
  const day = dayKey(value, timeZone);
  const today = dayKey(now, timeZone);

  if (day === today) {
    return time(value, timeZone);
  }

  if (day === dayBefore(today)) {
    return `вчера, ${time(value, timeZone)}`;
  }

  return formatDay(value, now, timeZone);
}

/**
 * Дата без времени: для того, что случается однажды, — заявка подана,
 * сотрудник заведён. Час подачи в очереди не работа, а шум.
 */
export function formatDay(value: Date, now: Date, timeZone: string): string {
  const sameYear = year(value, timeZone) === year(now, timeZone);
  return value.toLocaleDateString('ru-RU', {
    timeZone,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function time(value: Date, timeZone: string): string {
  return value.toLocaleTimeString('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit' });
}

/** Сутки в нужном поясе — тем же способом, каким считается «сегодня». */
function dayKey(value: Date, timeZone: string): string {
  return value.toLocaleDateString('en-CA', { timeZone });
}

/**
 * Предыдущие сутки — по календарю, а не вычитанием суток из отметки
 * времени: в переводящих часы поясах сутки бывают длиной 23 и 25 часов,
 * и «минус 24 часа» попадает то во вчера, то в позавчера.
 */
function dayBefore(key: string): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function year(value: Date, timeZone: string): string {
  return value.toLocaleDateString('en-CA', { timeZone, year: 'numeric' });
}
