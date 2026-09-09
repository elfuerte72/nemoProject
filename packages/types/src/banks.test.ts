import { describe, expect, it } from 'vitest';
import { bankSuggestionsFor } from './banks.js';

/**
 * Ярлыки к полю «Банк». Справочник, а не правило: проверяется то, что
 * от него ждут экраны, — состав, отсутствие повторов и молчание там,
 * где банка у валюты не бывает.
 */
describe('ярлыки банков', () => {
  it('у бата — банки из ТЗ владельца, каждый по разу', () => {
    expect(bankSuggestionsFor('THB')).toEqual([
      'Bangkok Bank',
      'Kasikornbank',
      'Krungthai Bank',
      'SCB',
      'Krungsri',
      'TTB',
    ]);
  });

  it('у рубля есть свои — поле «Банк» стоит и у карты, и у телефона', () => {
    expect(bankSuggestionsFor('RUB').length).toBeGreaterThan(0);
  });

  it('не зависит от регистра кода', () => {
    expect(bankSuggestionsFor('thb')).toEqual(bankSuggestionsFor('THB'));
  });

  it('у валюты без банков молчит: кошелёк и незнакомый код', () => {
    // USDT приходит на кошелёк, а не в банк, и ярлыкам там взяться
    // неоткуда: пустой список экран не показывает вовсе.
    expect(bankSuggestionsFor('USDT')).toEqual([]);
    expect(bankSuggestionsFor('XXX')).toEqual([]);
  });

  it('не повторяет банк дважды: подсказка с двумя одинаковыми ярлыками не подсказка', () => {
    for (const code of ['RUB', 'THB']) {
      const banks = bankSuggestionsFor(code);
      expect(new Set(banks).size).toBe(banks.length);
    }
  });
});
