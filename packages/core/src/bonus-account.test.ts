import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, type Actor } from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Реферальный кабинет: что клиент видит о своей сети и своих баллах.
 *
 * Про самих рефералов не видно ничего, кроме их количества. Клиент
 * пригласил знакомого — это не повод показывать ему, кого пригласил
 * знакомый и под каким именем.
 */

// Ключи нужны заявке на вывод: реквизиты получения шифруются при
// подаче. Сам кабинет их не трогает.
const keys = generateRequisiteKeyPair();
const core = createCore({
  db: testDatabase(),
  requisites: { publicKey: keys.publicKey, privateKey: keys.privateKey },
});

let manager: Actor & { type: 'staff' };

async function givenClient(
  telegramUserId: bigint,
  referralCode?: string,
): Promise<string> {
  const { client } = await core.registerClient({
    telegramUserId,
    username: `user${telegramUserId}`,
    ...(referralCode === undefined ? {} : { referralCode }),
  });
  return client.referralCode;
}

async function givenCompletedRequest(clientId: bigint, serviceIncome: string): Promise<void> {
  const { request } = await core.submitExchangeRequest(asClient(clientId), {
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
    serviceIncome,
    serviceIncomeCode: 'RUB',
  });
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  manager = await givenStaff();
});

afterAll(() => closeTestDatabase());

describe('бонусный баланс', () => {
  it('равен нулю, пока движений не было', async () => {
    await givenClient(1n);

    expect((await core.getBonusAccount(asClient(1n))).balance).toBe('0');
  });

  it('равен сумме всех движений по баллам', async () => {
    const code = await givenClient(1n);
    await givenClient(2n, code);

    await givenCompletedRequest(2n, '1000');
    await givenCompletedRequest(2n, '3000');

    // 5% от 1000 и 5% от 3000 — посчитано вручную от ставки первой линии.
    expect((await core.getBonusAccount(asClient(1n))).balance).toBe('200');
  });
});

describe('заработанное за всё время', () => {
  it('равно нулю, пока начислений не было', async () => {
    await givenClient(1n);

    expect((await core.getBonusAccount(asClient(1n))).earned).toBe('0');
  });

  it('не уменьшается от выплаты, в отличие от баланса', async () => {
    const code = await givenClient(1n);
    await givenClient(2n, code);
    // 5% от 40000 — начислено 2000, из них выведена половина.
    await givenCompletedRequest(2n, '40000');

    const card = await core.saveRequisites(asClient(1n), {
      kind: 'card',
      bankName: 'Сбербанк',
      cardNumber: '4081781009991000',
    });
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '1000',
      requisitesId: card.id,
    });
    await core.approveWithdrawalRequest(manager, request.id);
    await core.markWithdrawalPaid(manager, request.id);

    const account = await core.getBonusAccount(asClient(1n));

    // Остаток и заработок — разные числа: подписать выведенное как
    // незаработанное значит соврать о том, что принесла рефералка.
    expect({ balance: account.balance, earned: account.earned }).toEqual({
      balance: '1000',
      earned: '2000',
    });
  });
});

describe('размер сети', () => {
  it('показан числом рефералов по каждой линии', async () => {
    const first = await givenClient(1n);
    const second = await givenClient(2n, first);
    await givenClient(3n, first);
    await givenClient(4n, second);
    await givenClient(5n, second);

    const account = await core.getBonusAccount(asClient(1n));

    expect({ line1: account.line1Count, line2: account.line2Count }).toEqual({
      line1: 2,
      line2: 2,
    });
  });

  it('не раскрывает, кто эти люди', async () => {
    const code = await givenClient(1n);
    await givenClient(2n, code);
    await givenCompletedRequest(2n, '1000');

    const account = await core.getBonusAccount(asClient(1n));

    // Ни идентификатора реферала, ни его имени: начисление говорит,
    // за какую заявку начислено, но не за кого именно.
    expect(JSON.stringify(account)).not.toContain('user2');
    expect(JSON.stringify(account)).not.toContain('"2"');
  });
});

describe('ставки линий', () => {
  it('отдаются клиенту: программа без названной ставки не работает', async () => {
    await givenClient(1n);

    const account = await core.getBonusAccount(asClient(1n));

    // Те самые, по которым начисляет ядро, — из настроек сервиса, а не
    // числом в приложении: разойдясь, они пообещали бы клиенту не то,
    // что он получит.
    const settings = await core.getServiceSettings(await givenStaff({ role: 'admin' }));
    expect({ line1: account.line1Bps, line2: account.line2Bps }).toEqual({
      line1: settings.referralLine1Bps,
      line2: settings.referralLine2Bps,
    });
  });
});

describe('реферальная ссылка', () => {
  it('отдаётся клиенту его собственная', async () => {
    const code = await givenClient(1n);

    expect((await core.getBonusAccount(asClient(1n))).referralCode).toBe(code);
  });
});

describe('чужой кабинет', () => {
  it('сотруднику через клиентскую операцию не доступен', async () => {
    await givenClient(1n);

    await expect(core.getBonusAccount(manager)).rejects.toThrow(ForbiddenError);
  });
});
