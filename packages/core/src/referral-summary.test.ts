import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bonusTransactions } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenServiceSettings,
  givenStaff,
  testRequisiteKeys,
} from './test-support.js';

/**
 * Реферальная сводка: начисление считается в период исполнения заявки,
 * ставка в строке — та, что была тогда, выплата в «начислено» не
 * попадает, открытый вывод ждёт.
 */

const db = testDatabase();
const core = createCore({
  db,
  requisites: {
    publicKey: testRequisiteKeys.publicKey,
    privateKey: testRequisiteKeys.privateKey,
  },
});

let admin: Actor & { type: 'staff' };
let manager: Actor & { type: 'staff' };

const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);

/** Заявка реферала до исполнения — начисление рефереру внутри. */
async function completeFor(clientId: bigint, income: string): Promise<void> {
  const { request } = await core.submitExchangeRequest(asClient(clientId), {
    kind: 'cash',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100',
  });
  await core.claimExchangeRequest(manager, request.id);
  await core.confirmExchangeRate(manager, request.id, {
    finalRate: '80',
    toAmount: '8000',
    paymentInstructions: 'У кассы',
  });
  await core.markPaymentReceived(manager, request.id);
  await core.completeExchangeRequest(manager, request.id, {
    serviceIncome: income,
    serviceIncomeCode: 'USDT',
  });
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenServiceSettings({ markupBps: 200 });
  admin = await givenStaff({ displayName: 'Мария', role: 'admin' });
  manager = await givenStaff({ displayName: 'Пётр' });
  // Цепочка: 100 привёл 200, 200 привёл 300 — у 100 вторая линия на 300.
  const { client: first } = await core.registerClient({ telegramUserId: 100n, username: 'top' });
  const { client: second } = await core.registerClient({
    telegramUserId: 200n,
    referralCode: first.referralCode,
  });
  await core.registerClient({ telegramUserId: 300n, referralCode: second.referralCode });
});

afterAll(() => closeTestDatabase());

describe('реферальная сводка', () => {
  it('начислено по линиям за период, кто привёл больше всех', async () => {
    // Ставки по умолчанию: 5 % первой линии, 2 % второй.
    await completeFor(300n, '1000');

    const summary = await core.summarizeReferrals(admin, { from: at(1), to: at(-1) });

    expect(summary.accrued).toEqual([
      { line: 1, amount: '50', count: 1 },
      { line: 2, amount: '20', count: 1 },
    ]);
    expect(summary.referrers).toBe(2);
    expect(summary.top.map((one) => [one.telegramUserId, one.accrued])).toEqual([
      [200n, '50'],
      [100n, '20'],
    ]);
    expect(summary.paid).toBe('0');
    expect(summary.pending).toBe('0');
  });

  /*
   * Начисление живёт в моменте исполнения: сдвинутое в прошлый период,
   * оно уходит из этого — а ставка, записанная в строке, не меняется от
   * того, что настройка с тех пор другая.
   */
  it('начисление — в период исполнения, ставка — та, что была', async () => {
    await completeFor(300n, '1000');
    await db
      .update(bonusTransactions)
      .set({ createdAt: at(10) })
      .where(eq(bonusTransactions.clientId, 200n));
    await core.updateServiceSettings(admin, { referralLine1Bps: 1000 });

    const now = await core.summarizeReferrals(admin, { from: at(1), to: at(-1) });
    const before = await core.summarizeReferrals(admin, { from: at(15), to: at(5) });

    expect(now.accrued[0]).toEqual({ line: 1, amount: '0', count: 0 });
    expect(before.accrued[0]).toEqual({ line: 1, amount: '50', count: 1 });
  });

  it('выплата не попадает в начислено, открытый вывод ждёт', async () => {
    await completeFor(300n, '100000');
    const requisites = await core.saveRequisites(asClient(200n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });
    const { request: withdrawal } = await core.submitWithdrawalRequest(asClient(200n), {
      amount: '1000',
      requisitesId: requisites.id,
    });

    const pending = await core.summarizeReferrals(admin, { from: at(1), to: at(-1) });
    expect(pending.pending).toBe('1000');
    expect(pending.paid).toBe('0');

    await core.approveWithdrawalRequest(manager, withdrawal.id);
    await core.markWithdrawalPaid(manager, withdrawal.id);

    const paid = await core.summarizeReferrals(admin, { from: at(1), to: at(-1) });
    expect(paid.paid).toBe('1000');
    expect(paid.pending).toBe('0');
    expect(paid.accrued[0]?.amount).toBe('5000');
  });

  it('только администратору', async () => {
    await expect(
      core.summarizeReferrals(manager, { from: at(1), to: at(-1) }),
    ).rejects.toThrow(/только администратору/);
  });
});
