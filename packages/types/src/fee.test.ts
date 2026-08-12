import { describe, expect, it } from 'vitest';
import { Money } from './index.js';
import { feeFor, netAfterFee, type FeeTier } from './fee.js';

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
