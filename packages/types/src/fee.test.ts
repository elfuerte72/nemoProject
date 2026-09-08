import { describe, expect, it } from 'vitest';
import { Money } from './index.js';
import {
  feeFor,
  feeScheduleComplaint,
  feeSchedulePriceComplaint,
  feeScheduleSchema,
  feeTierSchema,
  parseFeeSchedule,
  netAfterFee,
  payoutAfterFee,
  type FeeTier,
} from './fee.js';

/**
 * Ступенчатая комиссия по ТЗ владельца от 10 и 12 августа 2026.
 *
 * Числа взяты из таблиц п. 3 каждого письма — они, а не формула под
 * ними: разбор в `.scratch/exchange-pricing/spec.md`. Ставка берётся со
 * всей суммы, а не с превышения над порогом, — тоже решение владельца.
 *
 * Сетки бата здесь — те, что прислал владелец, с фиксом на нижней
 * ступени меньше доли следующей. С 8 сентября 2026 такую сетку
 * сохранить нельзя («правила сетки» ниже); арифметике это безразлично,
 * она считает по тому, что ей дали, а числа сверены руками и остались.
 */

/** Баты на тайский банк. */
const BANK: readonly FeeTier[] = [
  { upToUsd: Money.toAmount('500'), fixedUsd: Money.toAmount('5') },
  { upToUsd: Money.toAmount('2000'), rateBps: 450 },
  { upToUsd: Money.toAmount('5000'), rateBps: 350 },
  { upToUsd: null, rateBps: 250 },
];

/** Баты в электронный кошелёк — дороже банка на процентный пункт. */
const WALLET: readonly FeeTier[] = [
  { upToUsd: Money.toAmount('500'), fixedUsd: Money.toAmount('10') },
  { upToUsd: Money.toAmount('2000'), rateBps: 550 },
  { upToUsd: Money.toAmount('5000'), rateBps: 450 },
  { upToUsd: null, rateBps: 350 },
];

/** Юани в кошелёк: ступеней три, а не четыре. */
const CNY: readonly FeeTier[] = [
  { upToUsd: Money.toAmount('500'), fixedUsd: Money.toAmount('10') },
  { upToUsd: Money.toAmount('2000'), rateBps: 200 },
  { upToUsd: null, rateBps: 100 },
];

describe('комиссия по ступеням', () => {
  it('на нижней ступени стоит фиксированную сумму', () => {
    expect(feeFor(Money.toAmount('100'), BANK)).toBe('5');
    expect(feeFor(Money.toAmount('500'), BANK)).toBe('5');
    expect(feeFor(Money.toAmount('100'), WALLET)).toBe('10');
  });

  it('выше нижней ступени считается процентом от всей суммы', () => {
    // Со всей суммы, а не с превышения над порогом: так в ТЗ.
    expect(feeFor(Money.toAmount('1000'), BANK)).toBe('45');
    expect(feeFor(Money.toAmount('1000'), WALLET)).toBe('55');
    expect(feeFor(Money.toAmount('1000'), CNY)).toBe('20');
  });

  it('берёт ставку последней ступени за её верхней границей', () => {
    expect(feeFor(Money.toAmount('10000'), BANK)).toBe('250');
    expect(feeFor(Money.toAmount('10000'), WALLET)).toBe('350');
    // У юаня ступеней три: выше двух тысяч ставка одна на всё.
    expect(feeFor(Money.toAmount('10000'), CNY)).toBe('100');
    expect(feeFor(Money.toAmount('4000'), CNY)).toBe('40');
  });

  it('меняет ступень строго за порогом, а не на нём', () => {
    expect(feeFor(Money.toAmount('2000'), BANK)).toBe('90');
    expect(feeFor(Money.toAmount('2000.01'), BANK)).toBe('70.00035');
    expect(feeFor(Money.toAmount('5000'), BANK)).toBe('175');
    expect(feeFor(Money.toAmount('5000.01'), BANK)).toBe('125.00025');
  });
});

describe('выдача после комиссии', () => {
  it('на границе нижней ступени бата падает — и такую сетку сохранить нельзя', () => {
    // Отдав на цент больше, клиент получает на 17,5 доллара меньше:
    // ставка берётся со всей суммы, а фикс в 5 $ на пятистах меньше
    // 4,5 % от них. До 8 сентября 2026 это считалось ценой решения;
    // владелец прочёл это у клиента как «на меньшую сумму курс лучше»
    // и назвал ошибкой. Арифметика считает как записано, а сохранить
    // такую сетку не даёт схема — словами, которые называют границу.
    expect(netAfterFee(Money.toAmount('500'), BANK)).toBe('495');
    expect(netAfterFee(Money.toAmount('500.01'), BANK)).toBe('477.50955');
    expect(feeScheduleComplaint(BANK)).toBe(
      'На границе 500 $ ступень до неё берёт 5 $, ступень после 22,50 $: меньшая сумма получила бы лучший курс',
    );
  });

  it('на границе верхних ступеней, наоборот, растёт', () => {
    // Отдать 2001 выгоднее, чем 2000: ставка упала на процентный пункт.
    expect(netAfterFee(Money.toAmount('2000'), BANK)).toBe('1910');
    expect(netAfterFee(Money.toAmount('2001'), BANK)).toBe('1930.965');
  });

  it('у юаня нижняя ступень сходится без обрыва', () => {
    // Десять долларов и есть 2% от пятисот: клиент на границе не теряет
    // ничего. В тайском письме владелец этого не выдержал — там 5
    // против 22,5, — и с 8 сентября 2026 такая сетка не сохраняется.
    expect(netAfterFee(Money.toAmount('500'), CNY)).toBe('490');
    expect(netAfterFee(Money.toAmount('500.01'), CNY)).toBe('490.0098');
  });

  it('не уходит ниже нуля на сумме меньше фиксированной ставки', () => {
    // Пять долларов при фиксе в десять — это выдача в минус. Такую
    // заявку отсекает минимальная сумма, но арифметика не должна
    // возвращать отрицательное: на нём ядро сочло бы курс испорченным
    // молча.
    expect(netAfterFee(Money.toAmount('5'), WALLET)).toBe('0');
  });
});

/**
 * Евро на банк — формула владельца от 17 августа 2026: процент от суммы
 * и десять евро сверху. Фикс задан в валюте выдачи и вычитается после
 * перевода по курсу — потому десять евро остаются десятью при любом
 * курсе (`.scratch/eur-usd-fee/spec.md`).
 */
const EUR: readonly FeeTier[] = [
  { upToUsd: Money.toAmount('2000'), rateBps: 330, fixedPayout: Money.toAmount('10') },
  { upToUsd: null, rateBps: 230, fixedPayout: Money.toAmount('10') },
];

/** Kraken за 14 августа 2026: столько евро дают за один доллар. */
const EUR_RATE = Money.toAmount('0.8649');

describe('выдача с фиксом в валюте выдачи', () => {
  it('берёт процент в долларах, а фикс вычитает после курса', () => {
    // Тысяча долларов: 3,3% — 33 $, остаток 967 $ по 0,8649 — 836,3583 €,
    // минус десять евро.
    expect(payoutAfterFee(Money.toAmount('1000'), EUR_RATE, EUR)).toBe('826.3583');
    // Три тысячи — уже 2,3%: 2931 $ → 2535,0219 € минус десять.
    expect(payoutAfterFee(Money.toAmount('3000'), EUR_RATE, EUR)).toBe('2525.0219');
  });

  it('сходится с проверкой владельца на его числах', () => {
    // 70 000 ₽ при курсе 87,98: долларов выходит 795,64 — ступень до
    // двух тысяч. Его формула даёт 655,44 €; целыми — 655.
    const usd = Money.toAmount('795.635371675380768356');

    const payout = payoutAfterFee(usd, EUR_RATE, EUR);

    expect(payout).toBe('655.436246874289611275');
    expect(Money.floor(payout)).toBe('655');
  });

  it('десять единиц валюты выдачи остаются десятью при любом курсе', () => {
    // В этом весь смысл фикса в валюте выдачи: долларом его не задать,
    // десять евро — переменное число долларов.
    expect(payoutAfterFee(Money.toAmount('1000'), Money.toAmount('2'), EUR)).toBe('1924');
    expect(payoutAfterFee(Money.toAmount('1000'), Money.toAmount('0.5'), EUR)).toBe('473.5');
  });

  it('работает и без процента — одним фиксом', () => {
    const flat: readonly FeeTier[] = [{ upToUsd: null, fixedPayout: Money.toAmount('10') }];

    // Сто долларов по 0,9 — девяносто, минус десять.
    expect(payoutAfterFee(Money.toAmount('100'), Money.toAmount('0.9'), flat)).toBe('80');
  });

  it('не уходит ниже нуля, когда фикс больше выдачи', () => {
    const flat: readonly FeeTier[] = [{ upToUsd: null, fixedPayout: Money.toAmount('10') }];

    // Десять долларов по 0,9 — девять евро, фикс десять. Минус — это
    // испорченный курс для ядра, а не цена.
    expect(payoutAfterFee(Money.toAmount('10'), Money.toAmount('0.9'), flat)).toBe('0');
  });

  it('меняет ступень строго за порогом, как и прежние сетки', () => {
    expect(payoutAfterFee(Money.toAmount('2000'), EUR_RATE, EUR)).toBe('1662.7166');
    expect(payoutAfterFee(Money.toAmount('2000.01'), EUR_RATE, EUR)).toBe('1680.023050073');
  });

  it('на сетке без фикса в валюте выдачи совпадает с прежним счётом', () => {
    // Бат и юань считаются как считались: новая арифметика для них —
    // то же умножение остатка на курс.
    const usd = Money.toAmount('1000');
    const rate = Money.toAmount('30');

    expect(payoutAfterFee(usd, rate, BANK)).toBe('28650');
    expect(payoutAfterFee(usd, rate, BANK)).toBe(
      Money.multiply(netAfterFee(usd, BANK), rate),
    );
  });

  it('складывает процент с фиксом в долларах', () => {
    // Доля и долларовый фикс теперь сочетаются: ставка — их сумма.
    const combo: readonly FeeTier[] = [
      { upToUsd: null, fixedUsd: Money.toAmount('5'), rateBps: 450 },
    ];

    // Тысяча долларов: 45 + 5 = 50, остаток 950 по тридцать — 28 500.
    expect(feeFor(Money.toAmount('1000'), combo)).toBe('50');
    expect(payoutAfterFee(Money.toAmount('1000'), Money.toAmount('30'), combo)).toBe('28500');
  });
});

describe('правила ступени', () => {
  it('отвергает два фикса разом', () => {
    // Один вычитается до умножения на курс, второй после: вместе они
    // означали бы, что никто не знает, сколько стоит обмен.
    const parsed = feeTierSchema.safeParse({
      upToUsd: null,
      fixedUsd: '5',
      fixedPayout: '10',
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? '' : parsed.error.issues[0]?.message).toMatch(/не оба разом/);
  });

  it('отвергает ступень без единой ставки', () => {
    const parsed = feeTierSchema.safeParse({ upToUsd: null });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? '' : parsed.error.issues[0]?.message).toMatch(/хотя бы одна/);
  });

  it('отвергает отрицательный фикс в валюте выдачи', () => {
    expect(feeTierSchema.safeParse({ upToUsd: null, fixedPayout: '-10' }).success).toBe(false);
  });

  it('сочетает долю с любым из фиксов', () => {
    expect(
      feeTierSchema.safeParse({ upToUsd: null, rateBps: 330, fixedPayout: '10' }).success,
    ).toBe(true);
    expect(
      feeTierSchema.safeParse({ upToUsd: null, rateBps: 450, fixedUsd: '5' }).success,
    ).toBe(true);
  });
});

/**
 * Доллар — ТЗ владельца от 29 августа 2026: «меньше 2 000 — 4,5 %,
 * иначе 3,5 %». Граница здесь не включительная: ровно две тысячи — уже
 * верхняя ступень. В его же ТЗ по юаню написано «до 2 000
 * включительно», и движок не выбирает между ними: знак границы —
 * свойство сетки, и по умолчанию он тот, что был всегда.
 */
const USD: readonly FeeTier[] = [
  { upToUsd: Money.toAmount('2000'), rateBps: 450 },
  { upToUsd: null, rateBps: 350 },
];

describe('граница ступени не включая', () => {
  it('ровно на пороге берёт ставку верхней ступени', () => {
    expect(feeFor(Money.toAmount('2000'), USD, { thresholdInclusive: false })).toBe('70');
    expect(feeFor(Money.toAmount('1999.99'), USD, { thresholdInclusive: false })).toBe(
      '89.99955',
    );
  });

  it('по умолчанию граница включительная, как у бата и юаня', () => {
    expect(feeFor(Money.toAmount('2000'), USD)).toBe('90');
    expect(feeFor(Money.toAmount('2000'), USD, { thresholdInclusive: true })).toBe('90');
  });

  it('выдача на пороге считается по верхней ступени', () => {
    // 2 000 − 3,5 % = 1 930; включительно вышло бы 1 910.
    expect(
      payoutAfterFee(Money.toAmount('2000'), Money.toAmount('1'), USD, {
        thresholdInclusive: false,
      }),
    ).toBe('1930');
    expect(payoutAfterFee(Money.toAmount('2000'), Money.toAmount('1'), USD)).toBe('1910');
  });
});

/**
 * Правило от 8 сентября 2026: большая сумма не стоит дороже меньшей.
 *
 * Владелец увидел у клиента, что на 25 000 ₽ бат выходит дешевле, чем на
 * 50 000 ₽, и назвал это ошибкой. Причина была в ступенях, а не в коде:
 * фикс 5 $ до пятисот против 4,5 % дальше. Правило сравнивает на каждой
 * границе комиссию до и после за одну и ту же сумму и отвергает сетку, у
 * которой вторая меньше первой. Слова отказа — те же, что покажет форма
 * панели до нажатия.
 */
describe('правила сетки', () => {
  /**
   * Нижняя ступень бата, какой её предложили владельцу: доля и фикс
   * разом. Фикс остаётся минимумом на мелких суммах, доля не даёт
   * границе провалиться.
   */
  const BANK_MONOTONE: readonly FeeTier[] = [
    { upToUsd: Money.toAmount('500'), rateBps: 450, fixedUsd: Money.toAmount('5') },
    ...BANK.slice(1),
  ];

  it('отвергает сетку, в которой большая сумма стоит дороже меньшей', () => {
    // По устройству сетка бата в порядке — не годится её цена. Разделение
    // важно: сохранённые сетки читаются без проверки цены.
    expect(feeScheduleSchema.safeParse(BANK).success).toBe(true);
    expect(parseFeeSchedule(BANK)).toEqual({
      ok: false,
      complaint:
        'На границе 500 $ ступень до неё берёт 5 $, ступень после 22,50 $: меньшая сумма получила бы лучший курс',
    });
    expect(feeScheduleComplaint(WALLET)).toBe(
      'На границе 500 $ ступень до неё берёт 10 $, ступень после 27,50 $: меньшая сумма получила бы лучший курс',
    );
  });

  it('принимает сетку, где фикс на границе равен доле следующей ступени', () => {
    // Равенство — не рост: десять долларов и есть 2 % от пятисот.
    expect(feeScheduleComplaint(CNY)).toBeNull();
  });

  it('принимает сетки евро и доллара как они заведены', () => {
    expect(feeScheduleComplaint(EUR)).toBeNull();
    expect(
      feeScheduleComplaint([
        { upToUsd: Money.toAmount('2000'), rateBps: 450 },
        { upToUsd: null, rateBps: 350 },
      ]),
    ).toBeNull();
  });

  it('отвергает фикс в валюте выдачи, растущий при равной долларовой части', () => {
    // Доллары на границе равны, а фикс в валюте выдачи после неё больше:
    // клиент, отдавший больше, получит меньше при любом курсе.
    expect(
      feeScheduleComplaint([
        { upToUsd: Money.toAmount('2000'), rateBps: 330, fixedPayout: Money.toAmount('10') },
        { upToUsd: null, rateBps: 330, fixedPayout: Money.toAmount('20') },
      ]),
    ).toBe(
      'На границе 2000 $ фикс в валюте выдачи растёт с 10 до 20: меньшая сумма получила бы лучший курс',
    );
  });

  it('называет несравнимое несравнимым, а не выдумывает нулевую комиссию', () => {
    // Доля после границы ниже, фикс в валюте выдачи выше: без курса не
    // сказать, что дороже. Отказ говорит это прямо, а не сравнивает
    // доллары с евро.
    const mixed =
      'одна часть комиссии растёт, другая падает, и без курса не сверить, что большая сумма не выходит дешевле';
    expect(
      feeScheduleComplaint([
        { upToUsd: Money.toAmount('2000'), rateBps: 330, fixedPayout: Money.toAmount('10') },
        { upToUsd: null, rateBps: 230, fixedPayout: Money.toAmount('20') },
      ]),
    ).toContain(mixed);
    // Нижняя ступень берёт только фикс в валюте выдачи: «берёт 0 $» было бы
    // неправдой — у неё есть цена, просто не в долларах.
    expect(
      feeScheduleComplaint([
        { upToUsd: Money.toAmount('500'), fixedPayout: Money.toAmount('100') },
        { upToUsd: null, rateBps: 450 },
      ]),
    ).toContain(mixed);
  });

  it('о перепутанных порогах говорит раньше, чем о цене', () => {
    // Сравнивать ступени по цене можно, только когда они стоят по порядку:
    // первым делом администратору называют порядок.
    expect(feeScheduleComplaint([BANK[1], BANK[0], BANK[3]])).toBe(
      'Пороги ступеней должны возрастать',
    );
  });

  it('негодную ступень отвергает словами, а не падает на арифметике', () => {
    // Отрицательная или дробная доля проходит схему маршрута панели
    // (`.int()` без нижней границы) и до правила о цене доходить не
    // должна: процент от суммы с такой долей бросает исключение.
    expect(
      feeScheduleComplaint([
        { upToUsd: Money.toAmount('500'), rateBps: -100 },
        { upToUsd: null, rateBps: 100 },
      ]),
    ).toBe('Ступени сетки заданы неверно');
    expect(
      feeScheduleComplaint([
        { upToUsd: Money.toAmount('500'), rateBps: 4.5 },
        { upToUsd: null, rateBps: 100 },
      ]),
    ).toBe('Ступени сетки заданы неверно');
  });

  it('печатает числа до знака, в котором они различаются', () => {
    // Две комиссии, обрезанные до сотых, читались бы как «14,99 против
    // 14,99» — отказ без видимой причины.
    expect(
      feeSchedulePriceComplaint([
        { upToUsd: Money.toAmount('333.33'), rateBps: 449, fixedUsd: Money.toAmount('0.03') },
        { upToUsd: null, rateBps: 450 },
      ]),
    ).toBe(
      'На границе 333,33 $ ступень до неё берёт 14,996517 $, ступень после 14,99985 $: меньшая сумма получила бы лучший курс',
    );
    // Фикс в валюте выдачи бывает мельче цента — у USDT, например.
    expect(
      feeSchedulePriceComplaint([
        { upToUsd: Money.toAmount('500'), rateBps: 450, fixedPayout: Money.toAmount('0.001') },
        { upToUsd: null, rateBps: 450, fixedPayout: Money.toAmount('0.002') },
      ]),
    ).toBe(
      'На границе 500 $ фикс в валюте выдачи растёт с 0,001 до 0,002: меньшая сумма получила бы лучший курс',
    );
  });

  it('с долей и фиксом на нижней ступени доля комиссии дальше только падает', () => {
    expect(parseFeeSchedule(BANK_MONOTONE)).toEqual({ ok: true, tiers: BANK_MONOTONE });

    const amounts = ['35', '100', '300', '500', '500.01', '1000', '2000', '2001', '5000', '5001'].map(
      Money.toAmount,
    );
    for (let index = 0; index + 1 < amounts.length; index += 1) {
      const less = amounts[index]!;
      const more = amounts[index + 1]!;
      // Доля на меньшей сумме не ниже доли на большей:
      // fee(less) / less ≥ fee(more) / more, без деления.
      const left = Money.multiply(feeFor(less, BANK_MONOTONE), more);
      const right = Money.multiply(feeFor(more, BANK_MONOTONE), less);
      expect(Money.compare(left, right)).toBeGreaterThanOrEqual(0);
    }
  });
});
