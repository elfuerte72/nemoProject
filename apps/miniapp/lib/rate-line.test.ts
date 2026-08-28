import { describe, expect, it } from 'vitest';
import type { QuoteView } from '@nemo/core';
import { Money } from '@nemo/types';
import { formatRate } from './format';
import { rateLine } from './rate-line';

/**
 * Черта курса на сетке: ноля на ней не бывает, а до набора суммы она не
 * пустует. Проверяется здесь, а не глазами: ноль появлялся только на
 * одной комбинации суммы и сетки — 28 августа 2026 на 1 000 ₽ в евро
 * черта показала «0 EUR за 1 RUB».
 */

/** Котировка RUB → EUR с прода 28 августа 2026: сетка евро, минимум 500 $. */
const RUB_TO_EUR: QuoteView = {
  rate: Money.toAmount('0'),
  toAmount: null,
  markupBps: 0,
  payoutDecimals: 2,
  asOf: new Date('2026-08-28T05:12:43Z'),
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
const USDT_TO_THB: QuoteView = {
  rate: Money.toAmount('0'),
  toAmount: null,
  markupBps: 0,
  payoutDecimals: 2,
  asOf: new Date('2026-08-28T05:12:43Z'),
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

const SERVICE_MIN = Money.toAmount('35');

describe('черта курса', () => {
  it('без сетки называет курс и без суммы', () => {
    const { fee: _fee, ...bare } = RUB_TO_EUR;
    const quote: QuoteView = { ...bare, rate: Money.toAmount('85') };

    expect(rateLine(quote, null, SERVICE_MIN)).toEqual({ kind: 'rate', rate: '85' });
  });

  it('до набора суммы называет курс на минимуме направления', () => {
    // 500 $ это 43 810,9 ₽; после 3,3 % и десяти евро остаётся 405,81 € —
    // 107,9599 рубля за евро, и вверх до сотых это 107,96: клиент
    // отдаёт за евро не меньше, чем стоит сделка. Не пустая черта и не
    // ноль.
    const line = rateLine(RUB_TO_EUR, null, SERVICE_MIN);

    expect(line.kind).toBe('rate');
    expect(formatRate((line as { rate: string }).rate, 'RUB', 'EUR')).toBe('107,96 RUB за 1 EUR');
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
    expect(formatRate((line as { rate: string }).rate, 'RUB', 'EUR')).toBe('107,63 RUB за 1 EUR');
  });

  it('без минимума направления опирается на минимум сервиса', () => {
    // У бата своего порога нет; ориентир до набора суммы — 35 USDT:
    // (35 − 5) × 32,82 = 984,6 бата, то есть 28,131 за монету — вниз до
    // сотых, 28,13.
    const line = rateLine(USDT_TO_THB, null, SERVICE_MIN);

    expect(line.kind).toBe('rate');
    expect(formatRate((line as { rate: string }).rate, 'USDT', 'THB')).toBe('28,13 THB за 1 USDT');
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
});
