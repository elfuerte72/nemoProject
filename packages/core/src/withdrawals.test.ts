import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { looksLikeCardNumber } from '@nemo/types';
import {
  createCore,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  TransitionNotAllowedError,
  type Actor,
} from './index.js';
import { asClient, givenCurrencyPair, givenNetwork, givenStaff } from './test-support.js';

/**
 * Заявка на вывод бонусных баллов.
 *
 * Выплату исполняет менеджер вручную. Баллы списываются в момент
 * отметки о выплате, поэтому проверки здесь — про то, что нельзя вывести
 * больше, чем есть, и что выплаченное списано ровно один раз.
 *
 * Куда платить, заявка не спрашивает отдельно: она ссылается на запись
 * из списка реквизитов клиента — тот же список, из которого выбирают при
 * обмене. Отсюда и проверки про чужую и архивную запись: выплата не по
 * тому реквизиту не возвращается.
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

/**
 * Номер карты, оканчивающийся нужными цифрами и сходящийся по
 * контрольной сумме: несходящийся операция отвергает, а хвост нужен
 * тестам — по нему в подписи реквизита клиент узнаёт свою запись.
 */
function cardEndingWith(tail: string): string {
  for (let digit = 0; digit <= 9; digit += 1) {
    const candidate = `40817810099${digit}${tail}`;
    if (looksLikeCardNumber(candidate)) return candidate;
  }
  throw new Error(`Не удалось построить номер, оканчивающийся на ${tail}`);
}

const CARD = cardEndingWith('4312');

/** Карта клиента: на неё по умолчанию и заявляют выплату. */
async function givenCard(owner = 1n, tail = '4312'): Promise<string> {
  const saved = await core.saveRequisites(asClient(owner), {
    kind: 'card',
    bankName: 'Сбербанк',
    cardNumber: cardEndingWith(tail),
  });
  return saved.id;
}

/** Адрес по форме своей сети: чужую операция отвергает как опечатку. */
const ADDRESSES: Readonly<Record<string, string>> = {
  TRC20: 'TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e',
  TON: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
};

async function givenWallet(network = 'TRC20'): Promise<string> {
  const saved = await core.saveRequisites(asClient(1n), {
    kind: 'wallet',
    network,
    address: ADDRESSES[network] ?? ADDRESSES.TRC20!,
  });
  return saved.id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenNetwork('TRC20');
  manager = await givenStaff();
});

afterAll(() => closeTestDatabase());

describe('подача заявки на вывод', () => {
  it('принимается на сумму в пределах баланса', async () => {
    await givenClientWithBonuses(5000);

    const { request, notifications } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenCard(),
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
        requisitesId: await givenCard(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергается на сумму больше баланса', async () => {
    await givenClientWithBonuses(5000);

    await expect(
      core.submitWithdrawalRequest(asClient(1n), {
        amount: '5001',
        requisitesId: await givenCard(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('берёт способ и сеть у самой записи, а не у клиента', async () => {
    await givenClientWithBonuses(5000);

    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenWallet(),
    });

    // Кошелёк исполняется криптовалютой, и сеть у него своя: назвать её
    // клиент не может — тот же адрес живёт в нескольких, и выбор наугад
    // означает потерянные деньги.
    expect(request).toMatchObject({ method: 'crypto', network: 'TRC20' });
  });

  it('не запоминает сеть у выплаты на карту: там её нет', async () => {
    await givenClientWithBonuses(5000);

    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenCard(),
    });

    expect(request.network).toBeNull();
  });

  it('не подаётся в сети, выключенной администратором', async () => {
    await givenClientWithBonuses(5000);
    await givenNetwork('TON');
    const wallet = await givenWallet('TON');
    await givenNetwork('TON', { isActive: false });

    // Справочник сетей один на весь сервис: закрывая сеть, администратор
    // закрывает её и для реквизитов обмена, и для выплат. Запись при
    // этом остаётся у клиента — сеть могут включить обратно.
    await expect(
      core.submitWithdrawalRequest(asClient(1n), { amount: '5000', requisitesId: wallet }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не принимает чужую запись', async () => {
    await givenClientWithBonuses(5000);
    const stranger = await givenCard(2n);

    // Чужая запись — «не найдена», а не «запрещена»: отличать одно от
    // другого значило бы подтверждать её существование перебирающему.
    await expect(
      core.submitWithdrawalRequest(asClient(1n), { amount: '5000', requisitesId: stranger }),
    ).rejects.toThrow(NotFoundError);
  });

  it('не принимает удалённую запись', async () => {
    await givenClientWithBonuses(5000);
    const card = await givenCard();
    await core.archiveRequisites(asClient(1n), card);

    await expect(
      core.submitWithdrawalRequest(asClient(1n), { amount: '5000', requisitesId: card }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('реквизиты получения', () => {
  it('клиенту видны только подписью', async () => {
    await givenClientWithBonuses(5000);

    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenCard(),
    });

    expect(request.destinationHint).toBe('Сбербанк · карта •••• 4312');
    // Ни в одном поле представления: клиентская часть номер карты
    // однажды сохранила и больше видеть его не должна.
    expect(Object.values(request).map(String)).not.toContain(CARD);
  });

  it('менеджеру открываются целиком — ему исполнять выплату', async () => {
    await givenClientWithBonuses(5000);
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenWallet(),
    });

    // Вместе с сетью: адрес без неё отправить некуда.
    expect(await core.revealWithdrawalDestination(manager, request.id)).toBe(
      'TRC20 · TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e',
    );
  });

  it('открываются с банком: номер карты без него никуда не отправить', async () => {
    await givenClientWithBonuses(5000);
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenCard(),
    });

    expect(await core.revealWithdrawalDestination(manager, request.id)).toBe(
      `Сбербанк · ${CARD}`,
    );
  });

  it('клиенту через ту же операцию не открываются', async () => {
    await givenClientWithBonuses(5000);
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenWallet(),
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
      requisitesId: await givenCard(),
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
    const card = await givenCard();
    await core.submitWithdrawalRequest(asClient(1n), { amount: '3000', requisitesId: card });

    // Первая заявка ещё не выплачена, но её сумма уже занята: иначе обе
    // прошли бы проверку и вместе вывели бы 6000 из 5000.
    await expect(
      core.submitWithdrawalRequest(asClient(1n), { amount: '3000', requisitesId: card }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('поданные одновременно, вместе не превышают баланс', async () => {
    await givenClientWithBonuses(5000);
    const card = await givenCard();

    const results = await Promise.allSettled([
      core.submitWithdrawalRequest(asClient(1n), { amount: '3000', requisitesId: card }),
      core.submitWithdrawalRequest(asClient(1n), { amount: '3000', requisitesId: card }),
    ]);

    expect(results.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
  });

  it('освобождают баллы, если заявку отклонили', async () => {
    await givenClientWithBonuses(5000);
    const card = await givenCard();
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: card,
    });
    await core.rejectWithdrawalRequest(manager, request.id, { reason: 'не тот банк' });

    const retried = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenCard(1n, '4399'),
    });

    expect(retried.request.status).toBe('new');
  });
});

describe('очередь выплат', () => {
  it('показывает менеджеру заявки в работе и скрывает закрытые', async () => {
    await givenClientWithBonuses(5000);
    const { request } = await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenCard(),
    });

    expect(await core.listWithdrawalQueue(manager)).toHaveLength(1);

    await core.rejectWithdrawalRequest(manager, request.id, { reason: 'не тот банк' });

    expect(await core.listWithdrawalQueue(manager)).toEqual([]);
  });

  it('клиенту показывает только его собственные заявки', async () => {
    await givenClientWithBonuses(5000);
    await core.submitWithdrawalRequest(asClient(1n), {
      amount: '5000',
      requisitesId: await givenCard(),
    });

    expect(await core.listWithdrawalRequests(asClient(2n))).toEqual([]);
    expect(await core.listWithdrawalRequests(asClient(1n))).toHaveLength(1);
  });
});
