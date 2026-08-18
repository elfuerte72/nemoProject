import { describe, expect, it } from 'vitest';
import { Money } from './index.js';
import { feeFor, feeTierSchema, netAfterFee, payoutAfterFee, type FeeTier } from './fee.js';

/**
 * Ступенчатая комиссия по ТЗ владельца от 10 и 12 августа 2026.
 *
 * Числа взяты из таблиц п. 3 каждого письма — они, а не формула под
 * ними: разбор в `.scratch/exchange-pricing/spec.md`. Ставка берётся со
 * всей суммы, а не с превышения над порогом, — тоже решение владельца,
 * и обрывы на границах здесь закреплены тестом намеренно: они не
 * ошибка, и «починка» их сломает договорённость.
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
  it('на границе нижней ступени падает — так решил владелец', () => {
    // Отдав на цент больше, клиент получает на 17,5 доллара меньше:
    // ставка берётся со всей суммы. Это записано в спеке ценой решения
    // и проверяется здесь, чтобы «починка» ломала тест, а не
    // договорённость.
    expect(netAfterFee(Money.toAmount('500'), BANK)).toBe('495');
    expect(netAfterFee(Money.toAmount('500.01'), BANK)).toBe('477.50955');
  });

  it('на границе верхних ступеней, наоборот, растёт', () => {
    // Отдать 2001 выгоднее, чем 2000: ставка упала на процентный пункт.
    expect(netAfterFee(Money.toAmount('2000'), BANK)).toBe('1910');
    expect(netAfterFee(Money.toAmount('2001'), BANK)).toBe('1930.965');
  });

  it('у юаня нижняя ступень сходится без обрыва', () => {
    // Десять долларов и есть 2% от пятисот: клиент на границе не теряет
    // ничего. В тайском письме владелец этого не выдержал — там 5
    // против 22,5.
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
