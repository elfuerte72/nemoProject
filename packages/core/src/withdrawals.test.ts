import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  createCore,
  ForbiddenError,
  InvalidInputError,
  TransitionNotAllowedError,
  type Actor,
} from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Заявка на вывод бонусных баллов.
 *
 * Выплату исполняет менеджер вручную. Баллы списываются в момент
 * отметки о выплате, поэтому проверки здесь — про то, что нельзя вывести
 * больше, чем есть, и что выплаченное списано ровно один раз.
 *
 * Минимальная сумма вывода по умолчанию — 1000 баллов: конкретное
 * значение задаёт администратор (блокер B1), но проверки должны знать,
 * от чего отталкиваются.
 */

const keys = generateRequisiteKeyPair();
const core = createCore({
  db: testDatabase(),
  requisites: { publicKey: keys.publicKey, privateKey: keys.privateKey },
});

let manager: Actor & { type: 'staff' };

/** Клиент с баллами: заработаны рефералом, чью заявку исполнил менеджер. */
async function givenClientWithBonuses(balance: number): Promise<void> {
  const { client } = await core.registerClient({ telegramUserId: 1n });
  await core.registerClient({ telegramUserId: 2n, referralCode: client.referralCode });

  // Ставка первой линии — 5%, значит доход должен быть в двадцать раз
  // больше нужного баланса.
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
    serviceIncome: String(balance * 20),
    serviceIncomeCode: 'RUB',
  });
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  manager = await givenStaff();
});

afterAll(() => closeTestDatabase());

describe('подача заявки на вывод', () => {
  it('принимается на сумму в пределах баланса', async () => {
    await givenClientWithBonuses(5000);

    const { request, notifications } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'bank',
      destination: '40817810099910004312',
    });

    expect(request).toMatchObject({ amount: '5000', method: 'bank', status: 'new' });
    expect(notifications).toEqual([
      expect.objectContaining({ kind: 'withdrawal-request-status', to: 1n, status: 'new' }),
    ]);
  });

  it('отвергается на сумму меньше минимальной из настроек', async () => {
    await givenClientWithBonuses(5000);

    await expect(
      core.submitWithdrawalRequest(asClient(1n), {
        amount: '999',
        method: 'crypto',
        destination: 'TXYZ',
        network: 'TRC20',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергается на сумму больше баланса', async () => {
    await givenClientWithBonuses(5000);

    await expect(
      core.submitWithdrawalRequest(asClient(1n), {
        amount: '5001',
        method: 'bank',
        destination: '40817810099910004312',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('требует сеть у выплаты в криптовалюте', async () => {
    await givenClientWithBonuses(5000);

    // Один и тот же адрес существует в нескольких сетях, и отправленное
    // не в ту не возвращается: угадывать её за клиента нельзя.
    await expect(
      core.submitWithdrawalRequest(asClient(1n), {
        amount: '5000',
        method: 'crypto',
        destination: 'TXYZabcdef1234567890',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не запоминает сеть у выплаты на счёт: там её нет', async () => {
    await givenClientWithBonuses(5000);

    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'bank',
      destination: '40817810099910004312',
      network: 'TRC20',
    });

    expect(request.network).toBeNull();
  });

  it('требует реквизиты получения', async () => {
    await givenClientWithBonuses(5000);

    await expect(
      core.submitWithdrawalRequest(asClient(1n), {
        amount: '5000',
        method: 'bank',
        destination: '   ',
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});

describe('реквизиты получения', () => {
  it('клиенту видны только хвостом', async () => {
    await givenClientWithBonuses(5000);

    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'bank',
      destination: '40817810099910004312',
    });

    expect(request.destinationHint).toBe('…4312');
    // Ни в одном поле представления: клиентская часть номер счёта
    // однажды сохранила и больше видеть его не должна.
    expect(Object.values(request).map(String)).not.toContain('40817810099910004312');
  });

  it('менеджеру открываются целиком — ему исполнять выплату', async () => {
    await givenClientWithBonuses(5000);
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'crypto',
      destination: 'TXYZabcdef1234567890',
      network: 'TRC20',
    });

    expect(await core.revealWithdrawalDestination(manager, request.id)).toBe(
      'TXYZabcdef1234567890',
    );
  });

  it('клиенту через ту же операцию не открываются', async () => {
    await givenClientWithBonuses(5000);
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'crypto',
      destination: 'TXYZabcdef1234567890',
      network: 'TRC20',
    });

    await expect(
      core.revealWithdrawalDestination(asClient(1n), request.id),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('обработка заявки менеджером', () => {
  async function givenSubmitted(): Promise<string> {
    await givenClientWithBonuses(5000);
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'bank',
      destination: '40817810099910004312',
    });
    return request.id;
  }

  it('проходит путь одобрения и выплаты, сообщая клиенту каждый шаг', async () => {
    const id = await givenSubmitted();

    const approved = await core.approveWithdrawalRequest(manager, id);
    const paid = await core.markWithdrawalPaid(manager, id);

    expect(approved.request.status).toBe('approved');
    expect(approved.notifications).toEqual([
      expect.objectContaining({ status: 'approved', to: 1n }),
    ]);
    expect(paid.request.status).toBe('paid');
    expect(paid.request.paidAt).toBeInstanceOf(Date);
    expect(paid.notifications).toEqual([expect.objectContaining({ status: 'paid', to: 1n })]);
  });

  it('списывает баллы ровно на выплаченную сумму', async () => {
    const id = await givenSubmitted();
    await core.approveWithdrawalRequest(manager, id);

    await core.markWithdrawalPaid(manager, id);

    expect((await core.getBonusAccount(asClient(1n))).balance).toBe('0');
  });

  it('не выплачивает заявку, минуя одобрение', async () => {
    const id = await givenSubmitted();

    await expect(core.markWithdrawalPaid(manager, id)).rejects.toThrow(
      TransitionNotAllowedError,
    );
  });

  it('отклоняет только с причиной, и клиент её видит', async () => {
    const id = await givenSubmitted();

    await expect(core.rejectWithdrawalRequest(manager, id, {})).rejects.toThrow(
      InvalidInputError,
    );

    const { request, notifications } = await core.rejectWithdrawalRequest(manager, id, {
      reason: 'реквизиты не совпадают с именем клиента',
    });

    expect(request.rejectReason).toBe('реквизиты не совпадают с именем клиента');
    expect(notifications).toEqual([
      expect.objectContaining({
        status: 'rejected',
        rejectReason: 'реквизиты не совпадают с именем клиента',
      }),
    ]);
  });

  it('не трогает баллы у отклонённой заявки', async () => {
    const id = await givenSubmitted();
    await core.rejectWithdrawalRequest(manager, id, { reason: 'не тот банк' });

    expect((await core.getBonusAccount(asClient(1n))).balance).toBe('5000');
  });

  it('не выплачивает выплаченное дважды', async () => {
    const id = await givenSubmitted();
    await core.approveWithdrawalRequest(manager, id);
    await core.markWithdrawalPaid(manager, id);

    await expect(core.markWithdrawalPaid(manager, id)).rejects.toThrow(
      TransitionNotAllowedError,
    );
    expect((await core.getBonusAccount(asClient(1n))).balance).toBe('0');
  });

  it('клиенту не даёт одобрить собственную заявку', async () => {
    const id = await givenSubmitted();

    await expect(core.approveWithdrawalRequest(asClient(1n), id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe('две заявки на одни баллы', () => {
  it('не выводят больше, чем есть на балансе', async () => {
    await givenClientWithBonuses(5000);
    await core.submitWithdrawalRequest(asClient(1n), {
      amount: '3000',
      method: 'bank',
      destination: '40817810099910004312',
    });

    // Первая заявка ещё не выплачена, но её сумма уже занята: иначе обе
    // прошли бы проверку и вместе вывели бы 6000 из 5000.
    await expect(
      core.submitWithdrawalRequest(asClient(1n), {
        amount: '3000',
        method: 'bank',
        destination: '40817810099910004312',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('поданные одновременно, вместе не превышают баланс', async () => {
    await givenClientWithBonuses(5000);

    const results = await Promise.allSettled([
      core.submitWithdrawalRequest(asClient(1n), {
        amount: '3000',
        method: 'bank',
        destination: '40817810099910004312',
      }),
      core.submitWithdrawalRequest(asClient(1n), {
        amount: '3000',
        method: 'bank',
        destination: '40817810099910004312',
      }),
    ]);

    expect(results.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
  });

  it('освобождают баллы, если заявку отклонили', async () => {
    await givenClientWithBonuses(5000);
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'bank',
      destination: '40817810099910004312',
    });
    await core.rejectWithdrawalRequest(manager, request.id, { reason: 'не тот банк' });

    const retried = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'bank',
      destination: '40817810099910004399',
    });

    expect(retried.request.status).toBe('new');
  });
});

describe('очередь выплат', () => {
  it('показывает менеджеру заявки в работе и скрывает закрытые', async () => {
    await givenClientWithBonuses(5000);
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'bank',
      destination: '40817810099910004312',
    });

    expect(await core.listWithdrawalQueue(manager)).toHaveLength(1);

    await core.rejectWithdrawalRequest(manager, request.id, { reason: 'не тот банк' });

    expect(await core.listWithdrawalQueue(manager)).toEqual([]);
  });

  it('клиенту показывает только его собственные заявки', async () => {
    await givenClientWithBonuses(5000);
    await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      method: 'bank',
      destination: '40817810099910004312',
    });

    expect(await core.listWithdrawalRequests(asClient(2n))).toEqual([]);
    expect(await core.listWithdrawalRequests(asClient(1n))).toHaveLength(1);
  });
});
