import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { conciergeFacts } from './concierge-facts.js';

/**
 * Справка консьержа: что в ней и в каком порядке.
 *
 * Порядок — не оформление: провайдер кэширует префикс запроса, совпавший
 * с прошлым, и кэш-хит дешевле обычного входа на порядки. Волатильное,
 * вставшее перед стабильным, рвало бы префикс на каждом запросе — и
 * правило теряется молча, перестановкой строк.
 */

const db = testDatabase();

beforeEach(async () => {
  await resetDatabase();
});
afterAll(() => closeTestDatabase());

describe('порядок справки', () => {
  it('волатильное идёт в хвосте: курсы меняются каждые полминуты, минималка — раз в неделю', async () => {
    const facts = await conciergeFacts({ db }, 100n);

    const minAmount = facts.indexOf('# Минимальная сумма обмена');
    const rates = facts.indexOf('# Курсы сейчас');
    const requests = facts.indexOf('# Заявки этого клиента');

    expect(minAmount).toBeGreaterThanOrEqual(0);
    expect(rates).toBeGreaterThan(minAmount);
    expect(requests).toBeGreaterThan(rates);
  });
});
