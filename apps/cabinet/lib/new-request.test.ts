import { describe, expect, it } from 'vitest';
import { Money, type Quote } from '@nemo/types';
import { describeRecipientInput, normalizeTyped, obstacleOf, parseTyped, sidesOf } from './new-request';

/**
 * Правила формы новой заявки, которых глазом не проверить: как читается
 * набранное, какая сторона считается по какой, как подписывается новый
 * получатель.
 */

const USDT_TO_RUB: Quote = { rate: Money.toAmount('81.5'), payoutDecimals: 2 };

describe('набранная сумма', () => {
  it('читается с запятой и пробелами разрядов', () => {
    expect(parseTyped('1 234,5')).toBe('1234.5');
    // И с тем узким пробелом, который поле расставляет само.
    expect(parseTyped('50\u202f000')).toBe('50000');
    expect(parseTyped('100')).toBe('100');
  });

  it('мусор и отрицательное — не сумма', () => {
    expect(parseTyped('abc')).toBeNull();
    expect(parseTyped('-5')).toBeNull();
    expect(parseTyped('')).toBeNull();
  });
});

describe('стороны сделки', () => {
  it('от отданного считает получаемое по курсу', () => {
    expect(sidesOf('100', 'give', USDT_TO_RUB)).toEqual({ give: '100', get: '8150' });
  });

  it('от желаемого считает отданное вверх', () => {
    // 50 000 / 81,5 = 613,49693251… — вверх, чтобы вышло не меньше.
    expect(sidesOf('50 000', 'get', USDT_TO_RUB)).toEqual({ give: '613.49693252', get: '50000' });
  });

  it('без курса считать нечем: остаётся только набранное', () => {
    expect(sidesOf('100', 'give', null)).toEqual({ give: '100', get: null });
    expect(sidesOf('100', 'get', null)).toEqual({ give: null, get: '100' });
  });

  it('пока в поле не число, сторон нет', () => {
    expect(sidesOf('1,', 'give', USDT_TO_RUB)).toEqual({ give: null, get: null });
  });
});

describe('что мешает подать', () => {
  // Само правило — в `@nemo/types`; здесь проверяется, что форма зовёт
  // его со своими разрядами: сумма порога читается как в таблицах.
  it('называет порог суммой с разрядами кабинета', () => {
    expect(
      obstacleOf({
        terms: { minAmount: Money.toAmount('35000'), minAmountCode: 'USDT' },
        fromCode: 'USDT',
        toCode: 'RUB',
        sides: sidesOf('10', 'give', USDT_TO_RUB),
        quote: USDT_TO_RUB,
        recipient: 'chosen',
      }),
    ).toBe('Меньше минимальной суммы обмена — 35\u202f000 USDT.');
  });
});

describe('получатель, названный в заявке', () => {
  it('подписывается так же, как сохранённая запись', () => {
    expect(
      describeRecipientInput({ kind: 'card', bankName: 'Тинькофф', cardNumber: '4111 1111 1111 5679' }),
    ).toBe('Тинькофф · карта •••• 5679');
    expect(
      describeRecipientInput({
        kind: 'wallet',
        network: 'TRC20',
        address: 'TQmXqE6VqVqVqVqVqVqVqVqVqVqVqaU6e',
      }),
    ).toBe('TRC20 · TQmX…aU6e');
    expect(
      describeRecipientInput({ kind: 'alipay', account: '+86 139 0000 0000', holderName: 'LI WEI' }),
    ).toBe('Alipay · +86 139 0000 0000');
  });
});

describe('разряды по окончании набора', () => {
  it('расставляются у числа и не трогают мусор', () => {
    // Разряды делит узкий неразрывный пробел — тот же, что у сумм в таблицах.
    expect(normalizeTyped('50000')).toBe('50\u202f000');
    expect(normalizeTyped('1,5')).toBe('1,5');
    expect(normalizeTyped('abc')).toBe('abc');
  });
});
