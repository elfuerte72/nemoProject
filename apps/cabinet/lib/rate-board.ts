import {
  arrangeRateBoard,
  currencyName,
  Money,
  payoutOf,
  rateLine,
  readRate,
  type Amount,
  type RateLine,
} from '@nemo/types';
import type { DirectionRate } from './direction-rates';

/**
 * Правила табло курсов — те, которых глазом не проверить.
 *
 * Сама раскладка по блокам живёт в `@nemo/types` (`arrangeRateBoard`) и
 * одна на сообщение бота и кабинет: рублёвая пара стоит отдельно,
 * потому что котировок у неё две, остальное идёт списком. Здесь то, что
 * табло делает поверх неё: разницу между покупкой и продажей, показанное
 * число курса, возраст котировки словами и сравнение снимков, по
 * которому поток решает, слать ли кадр.
 */

/** Рублёвая пара: обе стороны и разница между ними. */
export interface RubleBlock {
  /** USDT → RUB: мерчант продаёт монету. */
  readonly sell: DirectionRate | undefined;
  /** RUB → USDT: мерчант покупает монету. */
  readonly buy: DirectionRate | undefined;
  /** Разница между покупкой и продажей, в процентах. */
  readonly spread: Amount | null;
}

export interface Board {
  readonly ruble: RubleBlock;
  /** Всё остальное — одной таблицей, в порядке справочника валют. */
  readonly rows: readonly DirectionRate[];
}

/**
 * Что стоит блоком, а что строками.
 *
 * Рублёвая пара — единственная, у которой сервис стоит по обе стороны:
 * её и показывают покупкой с продажей. Всё прочее односторонне, и
 * второй стороны у него не существует — рисовать её было бы
 * выдумыванием второй цены.
 */
export function boardOf(directions: readonly DirectionRate[]): Board {
  const { sell, buy, payout, rest } = arrangeRateBoard(directions);
  return {
    ruble: { sell, buy, spread: spreadPercent(sell, buy) },
    rows: [...payout, ...rest],
  };
}

/**
 * Показанное число курса — одно правило на показ и на подсветку.
 *
 * Крупной стороной пары (`readRate` из `@nemo/types`): «98,04 RUB за
 * 1 EUR» читается, а «0,0102 EUR за 1 RUB» — нет. Сторона названа в
 * самой строке, поэтому столбец остаётся читаемым сверху вниз и без
 * общей для всех строк единицы.
 *
 * Тем же числом поток решает, в какую сторону подсветить строку:
 * сравнивать сырой курс нельзя — у перевёрнутой пары его рост означает
 * падение того, что видит человек.
 */
export function shownRate(direction: DirectionRate): Amount | null {
  if (!direction.rate) return null;
  return readRate(direction.rate, direction.fromCode, direction.toCode).value;
}

/**
 * Насколько покупка дороже продажи, в процентах.
 *
 * Считается от середины, как спред и считают: от одной из сторон он
 * вышел бы разным, смотря с какой стороны читать. Обе стороны берутся
 * тем же числом, каким они показаны, — иначе разница не сойдётся с тем,
 * что человек вычтет в уме.
 */
export function spreadPercent(
  sell: DirectionRate | undefined,
  buy: DirectionRate | undefined,
): Amount | null {
  if (!sell || !buy) return null;
  const bid = shownRate(sell);
  const ask = shownRate(buy);
  if (!bid || !ask) return null;

  const sum = Money.add(ask, bid);
  if (Money.isZero(sum) || Money.isNegative(sum)) return null;

  const middle = Money.divide(sum, Money.toAmount('2'));
  if (Money.isZero(middle)) return null;

  const difference = Money.subtract(ask, bid);
  const percent = Money.multiply(Money.divide(difference, middle), Money.toAmount('100'));
  // К ближайшему, а не вниз: это справочная величина, а не деньги, и
  // отброшенный хвост занижал бы её в пользу сервиса.
  return Money.roundTo(percent, 1);
}

/** Цена направления на набранную сумму: что на черте и что получат. */
export interface Price {
  readonly line: RateLine;
  readonly payout: Amount | null;
}

/**
 * Цена направления — на набранную сумму, а без неё на наименьшей, с
 * которой сервис по этому направлению работает.
 *
 * Своей арифметики здесь нет ни строки: и черта курса, и выдача
 * считаются тем же `rateLine` и `payoutOf` из `@nemo/types`, какими их
 * считает форма новой заявки, Mini App и ядро. Табло, посчитавшее
 * по-своему, пообещало бы одно, а заявка записала другое — и заметил
 * бы это мерчант, а не мы.
 */
export function priceOn(
  direction: DirectionRate,
  give: Amount | null,
  serviceMinUsd: Amount,
): Price {
  const quote = direction.quote;
  if (!quote) return { line: { kind: 'none' }, payout: null };
  return {
    line: rateLine(quote, give, serviceMinUsd),
    payout: give ? payoutOf(give, quote) : null,
  };
}

/** Чем направление зовётся в разметке и в сравнении кадров. */
export function pairKey(direction: DirectionRate): string {
  return `${direction.fromCode}/${direction.toCode}`;
}

/** Куда качнулся курс с прошлого кадра. */
export type Flash = 'up' | 'down';

/**
 * Что подсветить в пришедшем кадре.
 *
 * Сравнивается показанное число, а не сырой курс: у перевёрнутой пары
 * рост сырого означает падение того, что видит человек.
 *
 * Строка, которой в прошлом кадре не было, не подсвечивается — как и
 * строка, у которой курса не было вовсе: подсветка говорит «выросло с
 * того, что вы только что видели», и сравнивать её не с чем. По той же
 * причине первый кадр после открытия страницы не подсвечивает ничего.
 */
export function flashes(
  previous: readonly DirectionRate[],
  next: readonly DirectionRate[],
): Readonly<Record<string, Flash>> {
  const before = new Map(previous.map((one) => [pairKey(one), shownRate(one)]));
  const marks: Record<string, Flash> = {};
  for (const one of next) {
    const was = before.get(pairKey(one));
    const now = shownRate(one);
    if (!was || !now || was === now) continue;
    marks[pairKey(one)] = Money.compare(now, was) > 0 ? 'up' : 'down';
  }
  return marks;
}

/** Минута, час и сутки в миллисекундах — в тех же единицах, что `Date`. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Давно ли снята котировка.
 *
 * Отметка у каждой строки своя, и в этом весь смысл: биржевая живёт
 * минуту, опорный курс банка — сутки, и одна отметка на всё табло
 * соврала бы про половину строк. До 21 сентября 2026 её не было вовсе
 * ровно по этой причине.
 *
 * Полторы минуты считаются «только что»: снимок обновляется раз в
 * минуту, и «1 мин назад» у свежей котировки читалось бы как
 * задержка.
 */
export function quoteAge(quotedAt: string | null, now: Date): string {
  if (!quotedAt) return '';
  const at = new Date(quotedAt).getTime();
  if (Number.isNaN(at)) return '';

  const passed = now.getTime() - at;
  // Часы браузера могут отставать от серверных: котировка «из будущего»
  // — это расхождение часов, а не новость, и говорить о ней нечего.
  if (passed < 90_000) return 'только что';
  if (passed < HOUR) return `${Math.floor(passed / MINUTE)} мин назад`;
  if (passed < DAY) return `${Math.floor(passed / HOUR)} ч назад`;
  return 'больше суток';
}

/**
 * Изменился ли снимок — по нему поток решает, слать ли кадр.
 *
 * Сравниваются курс и отметка времени: при том же курсе новая отметка
 * всё равно новость — от неё считается возраст котировки в строке.
 * Пары сравниваются по порядку: справочник приходит одним и тем же
 * обходом, и перестановка в нём — тоже изменение.
 */
export function sameRates(
  left: readonly DirectionRate[],
  right: readonly DirectionRate[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((one, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      one.fromCode === other.fromCode &&
      one.toCode === other.toCode &&
      one.rate === other.rate &&
      one.quotedAt === other.quotedAt
    );
  });
}

/**
 * Строки, подходящие под набранное в поиске: код валюты или её
 * название по-русски.
 *
 * Поиск здесь клиентский, в отличие от очереди заявок, — и это не
 * исключение из правила, а другой случай: в очередь приходит страница
 * из базы, и «фильтр» поверх неё означал бы спрятанный разметкой
 * хвост, а табло целиком помещается на экране, и прятать за ним
 * нечего.
 */
export function rowsMatching(
  rows: readonly DirectionRate[],
  query: string,
): readonly DirectionRate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((one) =>
    [one.fromCode, one.toCode, currencyName(one.fromCode), currencyName(one.toCode)].some(
      (word) => word.toLowerCase().includes(needle),
    ),
  );
}
