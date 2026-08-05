import { describe, expect, it } from 'vitest';
import type { RatePair, RateQuote } from '@nemo/core';
import { Money } from '@nemo/types';
import { createChainRateSource } from './chain.js';

/**
 * Цепочка источников: пару котирует тот, кто её знает, а порядок решает
 * спор, если её знают оба.
 */

/** Источник, который котирует ровно перечисленные пары. */
function givenSource(rates: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    source: {
      async quote(pair: RatePair): Promise<RateQuote | null> {
        const key = `${pair.fromCode}/${pair.toCode}`;
        asked.push(key);
        const rate = rates[key];
        return rate === undefined ? null : { rate: Money.toAmount(rate), asOf: new Date(0) };
      },
    },
  };
}

describe('цепочка источников', () => {
  it('отдаёт ответ того, кто котирует пару', async () => {
    const exchange = givenSource({ 'USDT/RUB': '83.61' });
    const fiat = givenSource({ 'USDT/THB': '33.335' });
    const chain = createChainRateSource([exchange.source, fiat.source]);

    expect((await chain.quote({ fromCode: 'USDT', toCode: 'RUB' }))?.rate).toBe('83.61');
    expect((await chain.quote({ fromCode: 'USDT', toCode: 'THB' }))?.rate).toBe('33.335');
  });

  it('пуста, когда пары не знает никто', async () => {
    const exchange = givenSource({ 'USDT/RUB': '83.61' });
    const fiat = givenSource({ 'USDT/THB': '33.335' });
    const chain = createChainRateSource([exchange.source, fiat.source]);

    expect(await chain.quote({ fromCode: 'BTC', toCode: 'INR' })).toBeNull();
  });

  it('берёт рыночную цену, а не опорную, когда пару котируют оба', async () => {
    // Биржа стоит первой не по алфавиту: её цена — та, по которой на
    // рынке действительно торгуют.
    const exchange = givenSource({ 'USDT/USD': '1.0004' });
    const fiat = givenSource({ 'USDT/USD': '1' });
    const chain = createChainRateSource([exchange.source, fiat.source]);

    expect((await chain.quote({ fromCode: 'USDT', toCode: 'USD' }))?.rate).toBe('1.0004');
    // Второго провайдера при этом не беспокоят вовсе.
    expect(fiat.asked).toHaveLength(0);
  });
});
