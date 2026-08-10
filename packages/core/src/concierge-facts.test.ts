import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { conciergeFacts } from './concierge-facts.js';
import { createCore } from './index.js';
import { givenStaff } from './test-support.js';

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

describe('ставки рефералки', () => {
  it('называет проценты обеих линий из настроек', async () => {
    // Решение владельца от 10 августа 2026: проценты публичны. Живой
    // строкой из настроек, а не статьёй: администратор поменял ставку —
    // бот называет новую тем же днём.
    const admin = await givenStaff({ role: 'admin', telegramUserId: 903n });
    const core = createCore({ db, conciergeQuietMs: 0 });
    await core.updateServiceSettings(admin, {
      referralLine1Bps: 500,
      referralLine2Bps: 250,
    });

    const facts = await conciergeFacts({ db }, 100n);

    expect(facts).toContain('5%');
    expect(facts).toContain('2,5%');
    expect(facts).toContain('дохода');
  });
});

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
