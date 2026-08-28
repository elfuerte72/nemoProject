import { describe, expect, it } from 'vitest';
import { createPeggedRateSource } from './pegged.js';

/**
 * USDT — доллар по определению (ТЗ владельца от 29 августа 2026), а не
 * по чьей-то котировке. Проверяется здесь потому, что молчит: единица
 * выглядит как верный курс, а не как отсутствие цены, и провайдер,
 * подменивший её своей, заметен только сверкой с ТЗ.
 */
describe('пары по определению', () => {
  it('называет USDT долларом ровно единицей', async () => {
    const source = createPeggedRateSource();

    expect((await source.quote({ fromCode: 'USDT', toCode: 'USD' }))?.rate).toBe('1');
    expect((await source.quote({ fromCode: 'usdt', toCode: 'usd' }))?.rate).toBe('1');
  });

  it('приравнивает в обе стороны', async () => {
    const source = createPeggedRateSource();

    expect((await source.quote({ fromCode: 'USD', toCode: 'USDT' }))?.rate).toBe('1');
  });

  it('о прочих парах молчит', async () => {
    // Юань, евро и бат — рыночные, у них есть площадка; рубль — биржа.
    const source = createPeggedRateSource();

    expect(await source.quote({ fromCode: 'USDT', toCode: 'CNY' })).toBeNull();
    expect(await source.quote({ fromCode: 'USDT', toCode: 'EUR' })).toBeNull();
    expect(await source.quote({ fromCode: 'RUB', toCode: 'USDT' })).toBeNull();
    expect(await source.quote({ fromCode: 'USDT', toCode: 'USDT' })).toBeNull();
  });

  it('отвечает на ту отметку времени, на которую спросили', async () => {
    // Подача заявки просит курс «на тогда»: единица на тогда — та же
    // единица, и отметка возвращается спрошенной, а не текущей.
    const source = createPeggedRateSource();
    const then = new Date('2026-08-29T10:00:00Z');

    expect((await source.quote({ fromCode: 'USDT', toCode: 'USD' }, then))?.asOf).toEqual(then);
  });
});
