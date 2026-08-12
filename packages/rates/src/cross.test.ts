import { describe, expect, it } from 'vitest';
import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money } from '@nemo/types';
import { createCrossRateSource } from './cross.js';

/**
 * Составной курс: пара, которой не знает никто целиком, собирается из
 * двух звеньев через опорную валюту.
 */

/** Источник, который котирует ровно перечисленные пары. */
function givenSource(rates: Record<string, { rate: string; asOf?: Date }>): {
  readonly asked: string[];
  readonly source: RateSource;
} {
  const asked: string[] = [];
  return {
    asked,
    source: {
      async quote(pair: RatePair, at?: Date): Promise<RateQuote | null> {
        const key = `${pair.fromCode}/${pair.toCode}`;
        asked.push(at ? `${key}@${at.toISOString()}` : key);
        const known = rates[key];
        return known === undefined
          ? null
          : { rate: Money.toAmount(known.rate), asOf: known.asOf ?? new Date(0) };
      },
    },
  };
}

describe('составной курс через опорную валюту', () => {
  it('собирает пару из двух звеньев', async () => {
    // Рубль в бат не котирует никто: рублёвую сторону знает биржа,
    // тайскую — тайская биржа. Цена собирается умножением.
    const direct = givenSource({
      'RUB/USDT': { rate: '0.0125' },
      'USDT/THB': { rate: '33.11' },
    });
    const cross = createCrossRateSource(direct.source, { base: 'USDT' });

    expect((await cross.quote({ fromCode: 'RUB', toCode: 'THB' }))?.rate).toBe('0.413875');
  });

  it('молчит, когда молчит хотя бы одно звено', async () => {
    // Половина цены — не цена: курс, собранный из одного звена, был бы
    // выдуман, а по нему подают заявку.
    const direct = givenSource({ 'RUB/USDT': { rate: '0.0125' } });
    const cross = createCrossRateSource(direct.source, { base: 'USDT' });

    expect(await cross.quote({ fromCode: 'RUB', toCode: 'THB' })).toBeNull();
  });

  it('называет курс не свежее самого несвежего звена', async () => {
    // Отметка времени говорит, на когда цена верна. Взяв младшую из
    // двух, сервис обещал бы свежесть, которой у половины цены нет.
    const older = new Date('2026-08-12T10:00:00.000Z');
    const newer = new Date('2026-08-12T10:05:00.000Z');
    const direct = givenSource({
      'RUB/USDT': { rate: '0.0125', asOf: newer },
      'USDT/THB': { rate: '33.11', asOf: older },
    });
    const cross = createCrossRateSource(direct.source, { base: 'USDT' });

    expect((await cross.quote({ fromCode: 'RUB', toCode: 'THB' }))?.asOf).toEqual(older);
  });

  it('не берётся за пару, у которой опорная валюта с краю', async () => {
    // Такую пару спрашивали у прямых источников до него, и если они
    // молчат — цены нет. Составлять её означало бы умножить курс на
    // единицу и выдать тот же молчащий ответ за котировку.
    const direct = givenSource({ 'USDT/THB': { rate: '33.11' } });
    const cross = createCrossRateSource(direct.source, { base: 'USDT' });

    expect(await cross.quote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
    expect(await cross.quote({ fromCode: 'RUB', toCode: 'USDT' })).toBeNull();
    expect(direct.asked).toHaveLength(0);
  });

  it('спрашивает оба звена на ту же отметку времени', async () => {
    // Заявка уходит по курсу, который клиент видел, и звенья должны
    // быть теми же самыми: свежее звено рядом со старым дало бы цену,
    // которой на экране не было.
    const at = new Date('2026-08-12T10:00:00.000Z');
    const direct = givenSource({
      'RUB/USDT': { rate: '0.0125' },
      'USDT/THB': { rate: '33.11' },
    });
    const cross = createCrossRateSource(direct.source, { base: 'USDT' });

    await cross.quote({ fromCode: 'RUB', toCode: 'THB' }, at);

    expect(direct.asked).toEqual([
      `RUB/USDT@${at.toISOString()}`,
      `USDT/THB@${at.toISOString()}`,
    ]);
  });

  it('не отдаёт нулевой курс за котировку', async () => {
    // Ноль приходит от испорченной котировки, и умножение разносит его
    // дальше: клиент увидел бы «получаю 0» вместо честного молчания.
    const direct = givenSource({
      'RUB/USDT': { rate: '0' },
      'USDT/THB': { rate: '33.11' },
    });
    const cross = createCrossRateSource(direct.source, { base: 'USDT' });

    expect(await cross.quote({ fromCode: 'RUB', toCode: 'THB' })).toBeNull();
  });
});
