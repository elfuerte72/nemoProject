import { describe, expect, it } from 'vitest';
import * as Money from './money.js';
import type { Amount } from './money.js';
import {
  giveFor,
  minimumMeasure,
  payoutOf,
  rateLine,
  submissionObstacle,
  type Quote,
} from './quote.js';
import { sayRate } from './rate.js';

/**
 * Арифметика экрана обмена — та же, что в ядре, и одна на Mini App,
 * кабинет мерчанта и API: сколько получат за отданное, сколько отдать
 * за желаемое и что стоит на черте курса.
 *
 * Черта курса на сетке: ноля на ней не бывает, а до набора суммы она не
 * пустует. Проверяется здесь, а не глазами: ноль появлялся только на
 * одной комбинации суммы и сетки — 28 августа 2026 на 1 000 ₽ в евро
 * черта показала «0 EUR за 1 RUB».
 */

/** Число с запятой и без хвоста нулей — так его показывает клиент. */
function digits(value: Amount): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const tail = fraction.replace(/0+$/, '');
  return tail ? `${whole},${tail}` : whole;
}

function say(rate: Amount, fromCode: string, toCode: string): string {
  return sayRate(rate, fromCode, toCode, digits);
}

/** Котировка RUB → EUR с прода 28 августа 2026: сетка евро, минимум 500 $. */
const RUB_TO_EUR: Quote = {
  rate: Money.toAmount('0'),
  payoutDecimals: 2,
  fee: {
    toBaseRate: Money.toAmount('0.01141291942478886'),
    fromBaseRate: Money.toAmount('0.86'),
    tiers: [
      { upToUsd: Money.toAmount('2000'), rateBps: 330, fixedPayout: Money.toAmount('10') },
      { upToUsd: null, rateBps: 230, fixedPayout: Money.toAmount('10') },
    ],
    minUsd: Money.toAmount('500'),
    thresholdInclusive: true,
  },
};

/** Сетка бата: фикс пять долларов до пятисот, минимума направления нет. */
const USDT_TO_THB: Quote = {
  rate: Money.toAmount('0'),
  payoutDecimals: 2,
  fee: {
    toBaseRate: Money.toAmount('1'),
    fromBaseRate: Money.toAmount('32.82'),
    tiers: [
      { upToUsd: Money.toAmount('500'), fixedUsd: Money.toAmount('5') },
      { upToUsd: null, rateBps: 250 },
    ],
    minUsd: null,
    thresholdInclusive: true,
  },
};

/** Направление без сетки: курс один на любую сумму. */
const USDT_TO_RUB: Quote = { rate: Money.toAmount('81.5'), payoutDecimals: 2 };

const SERVICE_MIN = Money.toAmount('35');

describe('черта курса', () => {
  it('без сетки называет курс и без суммы', () => {
    expect(rateLine(USDT_TO_RUB, null, SERVICE_MIN)).toEqual({ kind: 'rate', rate: '81.5' });
  });

  it('до набора суммы называет курс на минимуме направления', () => {
    // 500 $ это 43 810,9 ₽; после 3,3 % и десяти евро остаётся 405,81 € —
    // 107,9599 рубля за евро, и вверх до сотых это 107,96: клиент
    // отдаёт за евро не меньше, чем стоит сделка. Не пустая черта и не
    // ноль.
    const line = rateLine(RUB_TO_EUR, null, SERVICE_MIN);

    expect(line.kind).toBe('rate');
    expect(say((line as { rate: Amount }).rate, 'RUB', 'EUR')).toBe('107,96 RUB за 1 EUR');
  });

  it('ниже минимума направления зовёт к порогу в валюте отдачи', () => {
    // Тысяча рублей это 11 $ при минимуме 500 $. Выдача — ноль, и
    // раньше ноль попадал в курс. Порог назван в том, что клиент
    // набирает: 500 $ по звену 0,01141 — 43 810,9 ₽, до целого вверх.
    expect(rateLine(RUB_TO_EUR, Money.toAmount('1000'), SERVICE_MIN)).toEqual({
      kind: 'from',
      giveAtLeast: '43811',
    });
  });

  it('от минимума и выше называет курс от набранного', () => {
    // 50 000 ₽ это 570,65 $: минус 3,3 % и десять евро — 464,56 €, то
    // есть 107,6287 рубля за евро, вверх — 107,63.
    const line = rateLine(RUB_TO_EUR, Money.toAmount('50000'), SERVICE_MIN);

    expect(line.kind).toBe('rate');
    expect(say((line as { rate: Amount }).rate, 'RUB', 'EUR')).toBe('107,63 RUB за 1 EUR');
  });

  it('без минимума направления опирается на минимум сервиса', () => {
    // У бата своего порога нет; ориентир до набора суммы — 35 USDT:
    // (35 − 5) × 32,82 = 984,6 бата, то есть 28,131 за монету — вниз до
    // сотых, 28,13.
    const line = rateLine(USDT_TO_THB, null, SERVICE_MIN);

    expect(line.kind).toBe('rate');
    expect(say((line as { rate: Amount }).rate, 'USDT', 'THB')).toBe('28,13 THB за 1 USDT');
  });

  it('сумму, съеденную фиксом целиком, не называет нулём', () => {
    // Три доллара при фиксе в пять: к выдаче ничего. Вместо «0 THB за
    // 1 USDT» — «от 35 USDT», порог сервиса.
    expect(rateLine(USDT_TO_THB, Money.toAmount('3'), SERVICE_MIN)).toEqual({
      kind: 'from',
      giveAtLeast: '35',
    });
  });

  it('молчит, когда ориентира нет вовсе', () => {
    expect(rateLine(USDT_TO_THB, null, null)).toEqual({ kind: 'none' });
    expect(rateLine(USDT_TO_THB, Money.toAmount('3'), null)).toEqual({ kind: 'none' });
  });

  it('нулевой курс без сетки не называет: нуля на черте не бывает', () => {
    // Испорченная котировка — не курс. «0 RUB за 1 USDT» читалось бы
    // как «не дадут ничего», а не как «курса нет».
    expect(rateLine({ rate: Money.ZERO, payoutDecimals: 2 }, null, SERVICE_MIN)).toEqual({
      kind: 'none',
    });
  });
});

describe('сколько получат за отданное', () => {
  it('без сетки умножает на курс и округляет до знака валюты', () => {
    expect(payoutOf(Money.toAmount('100'), USDT_TO_RUB)).toBe('8150');
    // 0,333 × 81,5 = 27,1395 — до сотых к ближайшему.
    expect(payoutOf(Money.toAmount('0.333'), USDT_TO_RUB)).toBe('27.14');
  });

  it('со ступенями считает путь целиком: доллары, ставка, валюта выдачи', () => {
    // Сто долларов на нижней ступени: минус пять фикса, 95 × 32,82.
    expect(payoutOf(Money.toAmount('100'), USDT_TO_THB)).toBe('3117.9');
  });
});

describe('сколько отдать, чтобы получить', () => {
  it('без сетки делит вверх до восьми знаков', () => {
    // 50 000 / 81,5 = 613,49693251533… — вверх, а не вниз: отброшенный
    // хвост вернулся бы умножением как недостача.
    const give = giveFor(Money.toAmount('50000'), USDT_TO_RUB);

    expect(give).toBe('613.49693252');
    expect(Money.compare(payoutOf(give!, USDT_TO_RUB), Money.toAmount('50000'))).toBeGreaterThanOrEqual(0);
  });

  it('просивший ровно столько получает не меньше и на сетке', () => {
    for (const target of ['1000', '3117.9', '16410', '50000']) {
      const give = giveFor(Money.toAmount(target), USDT_TO_THB);

      expect(give).not.toBeNull();
      expect(Money.compare(payoutOf(give!, USDT_TO_THB), Money.toAmount(target))).toBeGreaterThanOrEqual(0);
    }
  });

  it('на сетке отвечает наименьшей суммой, которой уже хватает', () => {
    // 3 117,9 бата — ровно сто долларов на нижней ступени; на копейку
    // меньше отдачи уже не хватит.
    const give = giveFor(Money.toAmount('3117.9'), USDT_TO_THB);

    expect(give).toBe('100');
  });

  it('без курса обратного счёта нет', () => {
    expect(giveFor(Money.toAmount('100'), { rate: Money.ZERO, payoutDecimals: 2 })).toBeNull();
    expect(
      giveFor(Money.toAmount('100'), {
        ...USDT_TO_THB,
        fee: { ...USDT_TO_THB.fee!, fromBaseRate: Money.ZERO },
      }),
    ).toBeNull();
  });
});

describe('чем меряется минимальная сумма', () => {
  const sides = { give: Money.toAmount('100'), get: Money.toAmount('8150') };

  it('там, где цену назначает сетка, — долларовым эквивалентом', () => {
    expect(
      minimumMeasure({
        thresholdCode: 'USDT',
        fromCode: 'RUB',
        toCode: 'THB',
        ...sides,
        usdAmount: Money.toAmount('1.14'),
      }),
    ).toBe('1.14');
  });

  it('иначе — стороной в валюте порога', () => {
    expect(
      minimumMeasure({ thresholdCode: 'USDT', fromCode: 'USDT', toCode: 'RUB', ...sides, usdAmount: null }),
    ).toBe('100');
    expect(
      minimumMeasure({ thresholdCode: 'USDT', fromCode: 'RUB', toCode: 'USDT', ...sides, usdAmount: null }),
    ).toBe('8150');
  });

  it('без того и другого порог не меряется', () => {
    expect(
      minimumMeasure({ thresholdCode: 'USDT', fromCode: 'RUB', toCode: 'THB', ...sides, usdAmount: null }),
    ).toBeNull();
  });
});

/** Сумма словами — как её показывает форма; здесь без разрядов. */
const money = (value: Amount, code: string) => `${value} ${code}`;

describe('что мешает подать', () => {
  const TERMS = { minAmount: Money.toAmount('35'), minAmountCode: 'USDT' };
  const RUB_EUR_MIN: Quote = {
    rate: Money.toAmount('0'),
    payoutDecimals: 2,
    fee: {
      toBaseRate: Money.toAmount('0.0114'),
      fromBaseRate: Money.toAmount('0.86'),
      tiers: [{ upToUsd: null, rateBps: 330, fixedPayout: Money.toAmount('10') }],
      minUsd: Money.toAmount('500'),
      thresholdInclusive: true,
    },
  };
  const at = (quote: Quote | null, give: string) => ({
    give: Money.toAmount(give),
    get: quote ? payoutOf(Money.toAmount(give), quote) : null,
  });

  it('ниже минимума сервиса — в валюте порога', () => {
    expect(
      submissionObstacle(
        { terms: TERMS, fromCode: 'USDT', toCode: 'RUB', sides: at(USDT_TO_RUB, '10'), quote: USDT_TO_RUB, recipient: 'chosen' },
        money,
      ),
    ).toBe('Меньше минимальной суммы обмена — 35 USDT.');
  });

  it('ниже минимума направления — в долларах, как задал владелец', () => {
    // 10 000 ₽ это 114 $ при пороге 500 $; сервисный минимум в 35 $ пройден.
    expect(
      submissionObstacle(
        { terms: TERMS, fromCode: 'RUB', toCode: 'EUR', sides: at(RUB_EUR_MIN, '10000'), quote: RUB_EUR_MIN, recipient: 'chosen' },
        money,
      ),
    ).toBe('Меньше минимальной суммы направления — 500 $.');
  });

  it('сумма, съеденная комиссией, — не заявка', () => {
    // Три доллара при фиксе в пять: к выдаче ничего.
    expect(
      submissionObstacle(
        {
          terms: { minAmount: Money.toAmount('1'), minAmountCode: 'USDT' },
          fromCode: 'USDT',
          toCode: 'THB',
          sides: at(USDT_TO_THB, '3'),
          quote: USDT_TO_THB,
          recipient: 'chosen',
        },
        money,
      ),
    ).toBe('Сумма слишком мала: после комиссии к выдаче ничего не останется.');
  });

  it('без получателя подавать некуда, а у валюты без родов перевод в разработке', () => {
    const base = { terms: TERMS, fromCode: 'USDT', toCode: 'RUB', sides: at(USDT_TO_RUB, '100'), quote: USDT_TO_RUB };
    expect(submissionObstacle({ ...base, recipient: 'missing' }, money)).toBe(
      'Укажите получателя: без реквизитов деньги некуда отправить.',
    );
    expect(submissionObstacle({ ...base, toCode: 'EUR', recipient: 'unsupported' }, money)).toBe(
      'Получение EUR переводом пока в разработке: реквизиты для этой валюты сервис ещё не принимает.',
    );
  });

  it('когда всё на месте, препятствий нет — и без курса порог не называется', () => {
    expect(
      submissionObstacle(
        { terms: TERMS, fromCode: 'USDT', toCode: 'RUB', sides: at(USDT_TO_RUB, '100'), quote: USDT_TO_RUB, recipient: 'chosen' },
        money,
      ),
    ).toBeUndefined();
    // Рубли за баты при молчащем источнике: USDT ни с одной стороны,
    // долларового эквивалента нет — подача проходит, курс назовёт менеджер.
    expect(
      submissionObstacle(
        { terms: TERMS, fromCode: 'RUB', toCode: 'THB', sides: at(null, '100'), quote: null, recipient: 'chosen' },
        money,
      ),
    ).toBeUndefined();
  });
});
