import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { clients, exchangeRequests, referrals, serviceSettings } from './schema.js';
import { closeTestDatabase, resetDatabase, testDatabase } from './testing.js';

/**
 * Правила, которые защищает сама база, а не код.
 *
 * Все они охраняют деньги, и все они должны выдерживать вызов в обход
 * прикладного слоя: повторно доставленный запрос, ручную правку в
 * консоли, ошибку в будущей операции. Проверка, живущая только в
 * TypeScript, от этого не спасает.
 */

const db = testDatabase();

beforeEach(() => resetDatabase(db));
afterAll(() => closeTestDatabase());

async function insertClient(telegramUserId: bigint, referrerId?: bigint): Promise<void> {
  await db.insert(clients).values({
    telegramUserId,
    referralCode: `ref-${telegramUserId}`,
    ...(referrerId === undefined ? {} : { referrerId }),
  });
}

describe('заявка на обмен', () => {
  it('не может стать исполненной без указанного дохода', async () => {
    await insertClient(1n);
    const [request] = await db
      .insert(exchangeRequests)
      .values({
        clientId: 1n,
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
      })
      .returning();

    await expect(
      db
        .update(exchangeRequests)
        .set({ status: 'completed' })
        .where(eq(exchangeRequests.id, request!.id)),
    ).rejects.toThrow(/exchange_requests_income_on_completion/);
  });

  it('становится исполненной, когда доход указан', async () => {
    await insertClient(1n);
    const [request] = await db
      .insert(exchangeRequests)
      .values({
        clientId: 1n,
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
      })
      .returning();

    const [completed] = await db
      .update(exchangeRequests)
      .set({ status: 'completed', serviceIncome: '250.5', serviceIncomeCode: 'RUB' })
      .where(eq(exchangeRequests.id, request!.id))
      .returning();

    expect(completed!.status).toBe('completed');
  });
});

describe('реферальная связь', () => {
  it('не может вести клиента к самому себе', async () => {
    await insertClient(1n);

    await expect(
      db.insert(referrals).values({ referrerId: 1n, referralId: 1n, line: 1 }),
    ).rejects.toThrow(/referrals_not_self/);
  });

  it('не позволяет клиенту быть собственным реферером', async () => {
    await expect(insertClient(1n, 1n)).rejects.toThrow(/clients_no_self_referral/);
  });

  it('не заходит глубже второй линии', async () => {
    await insertClient(1n);
    await insertClient(2n);

    await expect(
      db.insert(referrals).values({ referrerId: 1n, referralId: 2n, line: 3 }),
    ).rejects.toThrow(/referrals_line_range/);
  });
});

describe('настройки сервиса', () => {
  it('существуют сразу после применения миграций', async () => {
    const [settings] = await db.select().from(serviceSettings);

    expect(settings).toBeDefined();
    expect(settings!.referralLine1Bps).toBeGreaterThan(0);
  });

  it('существуют в единственном экземпляре', async () => {
    await expect(db.insert(serviceSettings).values({ id: 1 })).rejects.toThrow();
  });
});
