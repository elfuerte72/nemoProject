import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import type { DirectionRate } from './direction-rates';
import {
  boardOf,
  flashes,
  priceOn,
  quoteAge,
  sameRates,
  shownRate,
  spreadPercent,
} from './rate-board';

function direction(
  fromCode: string,
  toCode: string,
  rate: string | null,
  quotedAt: string | null = '2026-09-21T10:00:00.000Z',
): DirectionRate {
  return {
    fromCode,
    toCode,
    rate: rate === null ? null : Money.toAmount(rate),
    quote: null,
    quotedAt,
    minAmountUsd: null,
  };
}

/** Направление со ступенчатой сеткой: ставка верхней ступени — на выбор. */
function withTiers(rateBps: number): DirectionRate {
  return {
    ...direction('RUB', 'THB', '0.26'),
    quote: {
      rate: Money.toAmount('0'),
      payoutDecimals: 2,
      fee: {
        toBaseRate: Money.toAmount('0.011'),
        fromBaseRate: Money.toAmount('32'),
        tiers: [
          { upToUsd: Money.toAmount('2000'), fixedUsd: Money.toAmount('10'), rateBps: 450 },
          { upToUsd: null, rateBps },
        ],
        minUsd: null,
        thresholdInclusive: true,
      },
    },
  };
}

describe('boardOf', () => {
  it('ставит рублёвую пару блоком, остальное строками', () => {
    const board = boardOf([
      direction('USDT', 'THB', '32.2'),
      direction('USDT', 'RUB', '83'),
      direction('RUB', 'USDT', '0.0115'),
      direction('RUB', 'THB', '0.26'),
    ]);

    expect(board.ruble.sell?.toCode).toBe('RUB');
    expect(board.ruble.buy?.fromCode).toBe('RUB');
    expect(board.rows.map((one) => `${one.fromCode}/${one.toCode}`)).toEqual([
      'USDT/THB',
      'RUB/THB',
    ]);
  });

  it('без рублёвой пары блок пуст, а строки остаются', () => {
    const board = boardOf([direction('USDT', 'THB', '32.2')]);

    expect(board.ruble.sell).toBeUndefined();
    expect(board.ruble.spread).toBeNull();
    expect(board.rows).toHaveLength(1);
  });
});

describe('shownRate', () => {
  it('у прямой пары показывает её же число', () => {
    expect(shownRate(direction('USDT', 'THB', '32.2'))).toBe('32.2');
  });

  it('у перевёрнутой — крупную сторону', () => {
    // 0,0102 EUR за рубль — это 98,04 рубля за евро: числом в сотых
    // долях курс не читается и с соседним обменником не сравнивается.
    expect(shownRate(direction('RUB', 'EUR', '0.0102'))).toBe('98.04');
  });

  it('без курса молчит', () => {
    expect(shownRate(direction('USDT', 'TRY', null))).toBeNull();
  });
});

describe('spreadPercent', () => {
  it('считает разницу между покупкой и продажей от середины', () => {
    // Продают монету по 83 ₽, покупают по 86,96 — разница около 4,7 %.
    const spread = spreadPercent(
      direction('USDT', 'RUB', '83'),
      direction('RUB', 'USDT', '0.0115'),
    );
    expect(spread).toBe('4.7');
  });

  it('без одной из сторон разницы нет', () => {
    expect(spreadPercent(direction('USDT', 'RUB', '83'), undefined)).toBeNull();
    expect(spreadPercent(undefined, direction('RUB', 'USDT', '0.0115'))).toBeNull();
  });

  it('молчит, когда курса нет: делить на ноль нечем', () => {
    expect(
      spreadPercent(direction('USDT', 'RUB', null), direction('RUB', 'USDT', '0.0115')),
    ).toBeNull();
  });
});

describe('quoteAge', () => {
  const at = '2026-09-21T10:00:00.000Z';
  const after = (ms: number) => new Date(Date.parse(at) + ms);

  it('свежую котировку называет свежей', () => {
    expect(quoteAge(at, after(0))).toBe('только что');
    expect(quoteAge(at, after(89_000))).toBe('только что');
  });

  it('дальше считает минутами, часами и сутками', () => {
    expect(quoteAge(at, after(5 * 60_000))).toBe('5 мин назад');
    expect(quoteAge(at, after(59 * 60_000))).toBe('59 мин назад');
    expect(quoteAge(at, after(3 * 3_600_000))).toBe('3 ч назад');
    expect(quoteAge(at, after(25 * 3_600_000))).toBe('больше суток');
  });

  it('часы браузера впереди серверных — это не новость', () => {
    expect(quoteAge(at, after(-30_000))).toBe('только что');
  });

  it('без отметки молчит', () => {
    expect(quoteAge(null, after(0))).toBe('');
  });
});

describe('sameRates', () => {
  const snapshot = [direction('USDT', 'THB', '32.2'), direction('USDT', 'RUB', '83')];

  it('тот же снимок — кадр не уходит', () => {
    expect(sameRates(snapshot, [...snapshot])).toBe(true);
  });

  it('сменившийся курс — уходит', () => {
    expect(sameRates(snapshot, [direction('USDT', 'THB', '32.3'), snapshot[1]!])).toBe(false);
  });

  it('новая отметка при том же курсе — тоже уходит: от неё считается возраст', () => {
    const fresher = direction('USDT', 'THB', '32.2', '2026-09-21T10:01:00.000Z');
    expect(sameRates(snapshot, [fresher, snapshot[1]!])).toBe(false);
  });

  it('пропавшее направление — изменение', () => {
    expect(sameRates(snapshot, [snapshot[0]!])).toBe(false);
  });

  it('пришедший курс там, где его не было, — изменение', () => {
    const silent = [direction('USDT', 'THB', null)];
    expect(sameRates(silent, [direction('USDT', 'THB', '32.2')])).toBe(false);
  });

  it('правленая ступень сетки — изменение, даже когда курс и отметка те же', () => {
    // Администратор поднял ставку верхней ступени: опорный курс берётся
    // на минимуме направления и не двигается, отметка у пары от банка
    // суточная, — и без этого сравнения табло считало бы сумму по
    // вчерашним ступеням до самой ночи.
    const before = [withTiers(450)];
    const after = [withTiers(550)];
    expect(sameRates(before, after)).toBe(false);
  });

  it('тот же курс с той же сеткой — кадра нет', () => {
    expect(sameRates([withTiers(450)], [withTiers(450)])).toBe(true);
  });
});

describe('priceOn', () => {
  const minAmount = Money.toAmount('35');

  /** Направление со ступенчатой сеткой: фикс в долларах и процент сверху. */
  function withFee(): DirectionRate {
    return {
      ...direction('RUB', 'THB', '0.26'),
      quote: {
        rate: Money.toAmount('0'),
        payoutDecimals: 2,
        fee: {
          toBaseRate: Money.toAmount('0.011'),
          fromBaseRate: Money.toAmount('32'),
          tiers: [{ upToUsd: null, fixedUsd: Money.toAmount('10'), rateBps: 450 }],
          minUsd: Money.toAmount('500'),
          thresholdInclusive: true,
        },
      },
    };
  }

  it('без котировки не считает ничего', () => {
    const price = priceOn(direction('USDT', 'TRY', null), Money.toAmount('100'), minAmount);
    expect(price.line.kind).toBe('none');
    expect(price.payout).toBeNull();
  });

  it('сумма ниже порога направления — черта говорит «от», а выдачи нет', () => {
    const price = priceOn(withFee(), Money.toAmount('1000'), minAmount);
    expect(price.line.kind).toBe('from');
    expect(price.payout).toBeNull();
  });

  it('выдача, съеденная комиссией, не показывается нулём', () => {
    // Сто рублей — это доллар с небольшим, а фикс ступени десять
    // долларов: после комиссии не остаётся ничего, и «0 THB» читалось
    // бы как «столько и дадут».
    const price = priceOn(withFee(), Money.toAmount('100'), minAmount);
    expect(price.payout).toBeNull();
  });

  it('на самой границе ступени читает порог тем же знаком, что и ядро', () => {
    /*
     * Двести тысяч рублей — это ровно две тысячи долларов, то есть та
     * самая граница, из-за которой у сетки есть признак
     * `thresholdInclusive`: у бата и юаня «до 2 000 включительно», у
     * доллара по ТЗ от 29 августа 2026 «меньше 2 000». Экран, прочитавший
     * границу не тем знаком, разошёлся бы с заявкой на целую ставку.
     */
    function atBorder(inclusive: boolean): DirectionRate {
      return {
        ...direction('RUB', 'THB', '0.26'),
        quote: {
          rate: Money.toAmount('0'),
          payoutDecimals: 2,
          fee: {
            toBaseRate: Money.toAmount('0.01'),
            fromBaseRate: Money.toAmount('32'),
            tiers: [
              { upToUsd: Money.toAmount('2000'), rateBps: 450 },
              { upToUsd: null, rateBps: 1000 },
            ],
            minUsd: null,
            thresholdInclusive: inclusive,
          },
        },
      };
    }

    const border = Money.toAmount('200000');
    const included = priceOn(atBorder(true), border, minAmount);
    const excluded = priceOn(atBorder(false), border, minAmount);

    // Включительный порог оставляет границу нижней ступени — 4,5 %
    // против 10 %, и выдача по ней больше.
    expect(included.payout).toBe('61120');
    expect(excluded.payout).toBe('57600');
  });

  it('на достаточной сумме считает выдачу и курс на неё', () => {
    const price = priceOn(withFee(), Money.toAmount('100000'), minAmount);
    expect(price.line.kind).toBe('rate');
    expect(price.payout).not.toBeNull();
  });
});

describe('flashes', () => {
  it('подсвечивает рост и падение показанного числа', () => {
    const before = [direction('USDT', 'THB', '32.2'), direction('USDT', 'RUB', '83')];
    const after = [direction('USDT', 'THB', '32.4'), direction('USDT', 'RUB', '82.5')];

    expect(flashes(before, after)).toEqual({ 'USDT/THB': 'up', 'USDT/RUB': 'down' });
  });

  it('у перевёрнутой пары смотрит на то, что видит человек', () => {
    // Сырой курс вырос (0,0102 → 0,0104), а рублей за евро стало
    // меньше: 98,04 против 96,16. Для человека это падение.
    const before = [direction('RUB', 'EUR', '0.0102')];
    const after = [direction('RUB', 'EUR', '0.0104')];

    expect(flashes(before, after)).toEqual({ 'RUB/EUR': 'down' });
  });

  it('первый кадр не подсвечивает ничего: сравнивать не с чем', () => {
    expect(flashes([], [direction('USDT', 'THB', '32.2')])).toEqual({});
  });

  it('пришедший курс там, где его не было, не подсвечивается', () => {
    const before = [direction('USDT', 'TRY', null)];
    const after = [direction('USDT', 'TRY', '41')];

    expect(flashes(before, after)).toEqual({});
  });

  it('тот же курс — без подсветки', () => {
    const rows = [direction('USDT', 'THB', '32.2')];
    expect(flashes(rows, [...rows])).toEqual({});
  });

  it('тот же курс, записанный иначе, не подсвечивается', () => {
    // «83» и «83.000000000000000000» — одно число, пришедшее из
    // `numeric(38, 18)` разными путями. Сравнение записями красило бы
    // строку красным там, где не изменилось ничего.
    const before = [direction('USDT', 'RUB', '83')];
    const after = [direction('USDT', 'RUB', '83.000000000000000000')];
    expect(flashes(before, after)).toEqual({});
  });
});
