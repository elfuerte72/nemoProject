import { type Amount, Money } from '@nemo/types';
import { currencyFlag, currencyPlace, sortCurrencies } from '../currencies';
import { formatAmount, formatRate, formatRateValue, MAX_FRACTION_DIGITS } from '../format';

/**
 * Курс в чате — единственное место, где бот показывает данные.
 *
 * Отдельно от самого бота, потому что это единственная его страница со
 * вёрсткой: три блока, столбец, порядок валют и подпись. Проверять её
 * отправкой сообщения себе в чат — значит не проверять вовсе.
 *
 * Показывается весь справочник, а не одна пара с рублём: сервис выдаёт
 * девять валют, и клиент, спросивший курс, спрашивает про свою — про
 * баты перед поездкой, про лиры, про рупии. Ответ про один USDT он читал
 * как «остального у них нет».
 *
 * Собрано в три блока, потому что вопросы разные. Рубль стоит по обе
 * стороны обмена, и котировок у него две: наценка накладывается на
 * каждое направление отдельно, и покупка с продажей не зеркальны. Валюты
 * выдачи сервис только отдаёт — они идут столбцом, одной стороной на все
 * строки. Третий блок — на случай направления, не подходящего ни под
 * одно из двух: справочник растёт, и молча пропущенная строка хуже
 * некрасивой.
 *
 * Время снимка не подписано намеренно: биржевая котировка живёт
 * секундами, опорный курс банка — сутками, и одна отметка над столбцом
 * врала бы про половину строк.
 */

/**
 * Валюта, которую сервис принимает: от неё считается вся выдача, и
 * справочник направлений собран вокруг неё (docs/adr/0007).
 */
const BASE_CODE = 'USDT';

/** Единственная валюта, которую сервис и принимает, и выдаёт. */
const RUBLE_CODE = 'RUB';

/** Направление с курсом, по которому сервис его исполнит. */
export interface QuotedPair {
  readonly fromCode: string;
  readonly toCode: string;
  readonly rate: Amount;
}

/**
 * Молчание источника котировок — не поломка: заявку подать можно, и курс
 * по ней назовёт менеджер. Сказать об этом честно дешевле, чем показать
 * пустое место.
 */
export const RATES_UNAVAILABLE =
  'Курс сейчас недоступен: его назовёт менеджер после подачи заявки. ' +
  'Обменник работает как обычно.';

/**
 * Разметку в сообщении бот ставит свою, а коды валют приходят из
 * справочника: знак «меньше», попавший в код, увёл бы Telegram в разбор
 * тега — и сообщение не ушло бы вовсе.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Число в столбце валют выдачи: сколько её дают за одну монету.
 *
 * Сторона у столбца одна на все строки — иначе его не прочитать сверху
 * вниз: перевёрнутый курс отвечает на обратный вопрос, а заметить это
 * среди одинаковых строк невозможно. Поэтому здесь не `formatRateValue`:
 * он показывает крупную сторону пары, и у валют, которых за монету дают
 * меньше одной — доллара, евро, — строка перевернулась бы.
 *
 * Двух знаков довольно, и отброшены они вниз: посчитанное клиентом по
 * этому числу не больше того, что он получит, — сумму к выдаче ядро
 * округляет в ту же сторону.
 */
function payoutValue(rate: Amount): string {
  const shown = formatAmount(Money.format(rate, 2));
  // Валюты, которой за монету дают меньше сотой доли единицы, в
  // справочнике нет, но показать её нулём нельзя: ноль читается как
  // «не дадут ничего».
  return shown === '0' ? formatAmount(Money.format(rate, MAX_FRACTION_DIGITS)) : shown;
}

/**
 * Строка столбца: флаг, число, код и где эта валюта ходит.
 *
 * Число стоит перед кодом, а не за связкой в конце строки: сторона у
 * столбца одна и названа заголовком, так что связка ничего не добавляет,
 * зато семь одинаковых связок подряд превращают столбец в лесенку из
 * тире — по ней сообщение и читается набранным машиной. Заодно числа
 * встают почти друг под друга, а сравнивают в этом столбце именно их.
 */
function payoutLine({ toCode, rate }: QuotedPair): string {
  const place = currencyPlace(toCode);
  return (
    `${currencyFlag(toCode)} ${payoutValue(rate)} ${escapeHtml(toCode)}` +
    (place ? ` · ${place}` : '')
  );
}

/** Строка направления, не попавшего ни в рублёвый блок, ни в столбец. */
function otherLine({ fromCode, toCode, rate }: QuotedPair): string {
  return (
    `${currencyFlag(fromCode)} ${escapeHtml(fromCode)} → ` +
    `${currencyFlag(toCode)} ${escapeHtml(toCode)}: ` +
    formatRate(rate, fromCode, toCode)
  );
}

/**
 * Сообщение с курсом — размеченное для Telegram в HTML.
 *
 * Направления приходят уже с котировками: те, которых источник не знает,
 * до сюда не доходят вовсе — пустая строка в столбце читалась бы как
 * «этой валюты нет», хотя заявку в ней принимают.
 */
export function renderRatesMessage({
  quoted,
  hasCash,
}: {
  readonly quoted: readonly QuotedPair[];
  /** Есть ли у сервиса наличные направления: у них курса нет вовсе. */
  readonly hasCash: boolean;
}): string {
  const sell = quoted.find((one) => one.fromCode === BASE_CODE && one.toCode === RUBLE_CODE);
  const buy = quoted.find((one) => one.fromCode === RUBLE_CODE && one.toCode === BASE_CODE);

  // Порядок в столбце — тот же, что в списке выбора на экране: два
  // порядка одних и тех же валют клиенту пришлось бы сверять глазами.
  const payout = quoted.filter((one) => one.fromCode === BASE_CODE && one.toCode !== RUBLE_CODE);
  const order = sortCurrencies(payout.map((one) => one.toCode));
  payout.sort((left, right) => order.indexOf(left.toCode) - order.indexOf(right.toCode));

  const shown = new Set<QuotedPair>(
    [sell, buy, ...payout].filter((one) => one !== undefined),
  );
  const rest = quoted.filter((one) => !shown.has(one));

  const blocks: string[] = [];

  if (sell || buy) {
    blocks.push(
      [
        `<b>${currencyFlag(RUBLE_CODE)} USDT и рубль</b>`,
        sell ? `Продаёте USDT по ${formatRateValue(sell.rate)} ₽` : undefined,
        // Котировка «рубли → USDT» приходит в USDT за рубль.
        // Переворачивать её здесь не нужно: `formatRateValue` сам
        // показывает крупную сторону пары — числом вроде 0,0098 человек
        // не пользуется.
        buy ? `Покупаете USDT по ${formatRateValue(buy.rate)} ₽` : undefined,
      ]
        .filter((line) => line !== undefined)
        .join('\n'),
    );
  }

  if (payout.length > 0) {
    blocks.push([`<b>🌍 Выдаём за 1 USDT</b>`, ...payout.map(payoutLine)].join('\n'));
  }

  if (rest.length > 0) {
    blocks.push([`<b>Другие направления</b>`, ...rest.map(otherLine)].join('\n'));
  }

  const footer = [
    'Наценка сервиса в курсе уже учтена, по нему и обменяем. Заявку подают в обменнике.',
    // Про наличные — только там, где они есть: направление гасят из
    // панели, и обещать разговор, которого не будет, нельзя.
    hasCash ? 'У наличных биржевого курса нет, их считает менеджер.' : undefined,
  ].filter((line) => line !== undefined);

  return [`📈 <b>Курс обмена</b>`, ...blocks, footer.join('\n')].join('\n\n');
}
