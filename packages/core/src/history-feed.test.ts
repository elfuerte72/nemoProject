import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, type Actor } from './index.js';
import { asClient, givenCurrencyPair, givenNetwork, givenStaff } from './test-support.js';

/**
 * Лента истории клиента.
 *
 * Четыре потока сходятся в один список, и проверяется здесь именно
 * схождение: что ни один из них не потерялся, что порядок общий и что о
 * неполноте лента говорит сама.
 */

const keys = generateRequisiteKeyPair();
const core = createCore({
  db: testDatabase(),
  requisites: { publicKey: keys.publicKey, privateKey: keys.privateKey },
});

let manager: Actor & { type: 'staff' };

/** Клиент с баллами: их заработал приглашённый, чью заявку исполнил менеджер. */
async function givenBonuses(income: string): Promise<void> {
  const { client } = await core.registerClient({ telegramUserId: 1n });
  await core.registerClient({ telegramUserId: 2n, referralCode: client.referralCode });

  const { request } = await core.submitExchangeRequest(asClient(2n), {
    kind: 'cash',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100000',
  });
  await core.claimExchangeRequest(manager, request.id);
  await core.confirmExchangeRate(manager, request.id, {
    finalRate: '95',
    paymentInstructions: 'наличными в офисе',
  });
  await core.markPaymentReceived(manager, request.id);
  await core.completeExchangeRequest(manager, request.id, {
    serviceIncome: income,
    serviceIncomeCode: 'RUB',
  });
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenNetwork('TRC20');
  manager = await givenStaff();
});

afterAll(() => closeTestDatabase());

describe('лента истории', () => {
  it('пуста у клиента, с которым ещё ничего не происходило', async () => {
    await core.registerClient({ telegramUserId: 1n });

    expect(await core.getClientHistory(asClient(1n))).toEqual({
      entries: [],
      truncated: false,
    });
  });

  it('сводит все четыре потока в один список', async () => {
    await givenBonuses('40000');
    const card = await core.saveRequisites(asClient(1n), {
      kind: 'card',
      bankName: 'Сбербанк',
      cardNumber: '4081781009991000',
    });
    await core.submitWithdrawalRequest(asClient(1n), {
      amount: '1000',
      requisitesId: card.id,
    });
    await core.submitCardApplication(asClient(1n));
    await core.submitExchangeRequest(asClient(1n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '5000',
    });

    const { entries } = await core.getClientHistory(asClient(1n));

    expect(new Set(entries.map((entry) => entry.stream))).toEqual(
      new Set(['exchange', 'bonus', 'withdrawal', 'card']),
    );
  });

  it('идёт свежим сверху', async () => {
    await givenBonuses('40000');
    await core.submitCardApplication(asClient(1n));

    const { entries } = await core.getClientHistory(asClient(1n));
    const times = entries.map((entry) => entry.at.getTime());

    expect(times).toEqual([...times].sort((one, other) => other - one));
  });

  it('не показывает клиенту чужих движений', async () => {
    await givenBonuses('40000');
    // Заявку подавал приглашённый, а начисление за неё — у пригласившего.
    // В своей ленте каждый видит только собственную сторону.
    const { entries } = await core.getClientHistory(asClient(2n));

    expect(entries.map((entry) => entry.stream)).toEqual(['exchange']);
  });

  it('не обрезана, пока потоки не упёрлись в потолок', async () => {
    await givenBonuses('40000');

    expect((await core.getClientHistory(asClient(1n))).truncated).toBe(false);
  });
});

describe('чужая лента', () => {
  it('сотруднику через клиентскую операцию не доступна', async () => {
    await core.registerClient({ telegramUserId: 1n });

    await expect(core.getClientHistory(manager)).rejects.toThrow(ForbiddenError);
  });
});
