import { describe, expect, it } from 'vitest';
import {
  arrangeRateBoard,
  currencyFlag,
  currencyName,
  currencyPlace,
  sortCurrencies,
} from './currencies.js';

/**
 * Что человек знает о валюте помимо её кода. Порядок списка — правило,
 * а не случайность справочника: рубль первым, дальше по коду, незнакомое
 * в конец.
 */
describe('справочник валют', () => {
  it('ставит рубль первым, остальные по коду, незнакомые в конец', () => {
    expect(sortCurrencies(['THB', 'XXX', 'USDT', 'RUB', 'CNY'])).toEqual([
      'RUB',
      'CNY',
      'THB',
      'USDT',
      'XXX',
    ]);
  });

  it('не зависит от регистра кода', () => {
    expect(currencyName('thb')).toBe('Тайский бат');
    expect(currencyPlace('usdt')).toBe('Криптовалюта');
  });

  it('незнакомую валюту называет кодом, место оставляет пустым, флаг — белым', () => {
    expect(currencyName('XXX')).toBe('XXX');
    expect(currencyPlace('XXX')).toBe('');
    expect(currencyFlag('XXX')).toBe('🏳️');
  });
});

/**
 * Доска курсов — как в сообщении бота и в разделе «Курсы» кабинета:
 * рубль двумя строками, валюты выдачи столбцом за один USDT в порядке
 * списка выбора, остальное — своими строками.
 */
describe('раскладка доски курсов', () => {
  const pair = (fromCode: string, toCode: string) => ({ fromCode, toCode });

  it('делит справочник на рубль, столбец выдачи и остальное', () => {
    const board = arrangeRateBoard([
      pair('RUB', 'THB'),
      pair('USDT', 'THB'),
      pair('RUB', 'USDT'),
      pair('USDT', 'CNY'),
      pair('USDT', 'RUB'),
    ]);

    expect(board.sell).toEqual(pair('USDT', 'RUB'));
    expect(board.buy).toEqual(pair('RUB', 'USDT'));
    expect(board.payout.map((one) => one.toCode)).toEqual(['CNY', 'THB']);
    expect(board.rest).toEqual([pair('RUB', 'THB')]);
  });

  it('без рублёвых направлений обе строки пусты', () => {
    const board = arrangeRateBoard([pair('USDT', 'THB')]);
    expect(board.sell).toBeUndefined();
    expect(board.buy).toBeUndefined();
  });
});
