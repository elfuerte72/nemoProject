import { describe, expect, it } from 'vitest';
import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money } from '@nemo/types';
import { composeRateSources } from './index.js';

/**
 * Порядок провайдеров и место составного среди них.
 *
 * Проверяется здесь, а не глазами на проде: перестановка строки в сборке
 * молча меняет цену, по которой сервис обязуется работать, — прямая
 * котировка уступила бы место собранной, и заметить это можно только
 * сверив курс с биржей.
 */

function givenSource(rates: Record<string, string>): {
  readonly asked: string[];
  readonly source: RateSource;
} {
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

describe('сборка источников курса', () => {
  it('отдаёт прямую котировку, не собирая её', async () => {
    // Собранная цена — та, которой на рынке никто не называл. Пока
    // прямая есть, составной не должен участвовать вовсе.
    const exchange = givenSource({ 'USDT/RUB': '83.61' });
    const thai = givenSource({ 'USDT/THB': '33.07' });
    const rates = composeRateSources([exchange.source, thai.source]);

    expect((await rates.quote({ fromCode: 'USDT', toCode: 'THB' }))?.rate).toBe('33.07');
  });

  it('собирает пару, которой нет ни у кого', async () => {
    // Рубль в бат не котирует никто, а сервис идёт этой дорогой
    // взаправду: продаёт рубли за USDT, покупает на них баты.
    const exchange = givenSource({ 'RUB/USDT': '0.0125' });
    const thai = givenSource({ 'USDT/THB': '33.07' });
    const rates = composeRateSources([exchange.source, thai.source]);

    expect((await rates.quote({ fromCode: 'RUB', toCode: 'THB' }))?.rate).toBe('0.413375');
  });

  it('молчит, когда собрать пару не из чего', async () => {
    const exchange = givenSource({ 'RUB/USDT': '0.0125' });
    const thai = givenSource({ 'USDT/THB': '33.07' });
    const rates = composeRateSources([exchange.source, thai.source]);

    expect(await rates.quote({ fromCode: 'RUB', toCode: 'INR' })).toBeNull();
  });

  it('держит порядок прямых источников', async () => {
    // Пару знают оба, и взять надо цену первого: биржевую, а не
    // опорную.
    const exchange = givenSource({ 'USDT/THB': '33.07' });
    const bank = givenSource({ 'USDT/THB': '33.335' });
    const rates = composeRateSources([exchange.source, bank.source]);

    expect((await rates.quote({ fromCode: 'USDT', toCode: 'THB' }))?.rate).toBe('33.07');
    expect(bank.asked).toHaveLength(0);
  });
});
