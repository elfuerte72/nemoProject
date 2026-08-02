import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Реферальные начисления при исполнении заявки на обмен.
 *
 * Исполнение — единственная точка начисления во всей системе, и база
 * начисления — доход по заявке, а не её сумма (docs/adr/0003). Ожидаемые
 * суммы в тестах посчитаны руками от ставок по умолчанию — 500 bps
 * первой линии и 200 bps второй, — а не тем же выражением, что в коде:
 * иначе тест повторил бы ошибку кода и не заметил её.
 */

const core = createCore({ db: testDatabase() });

let manager: Actor & { type: 'staff' };

/** Клиент, пришедший по ссылке другого. Возвращает код своей ссылки. */
async function givenClient(
  telegramUserId: bigint,
  referralCode?: string,
): Promise<string> {
  const { client } = await core.registerClient({
    telegramUserId,
    ...(referralCode === undefined ? {} : { referralCode }),
  });
  return client.referralCode;
}

/** Заявка клиента, доведённая до исполнения с указанным доходом. */
async function givenCompletedRequest(
  clientId: bigint,
  serviceIncome: string,
): Promise<string> {
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
  return request.id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  manager = await givenStaff();
});

afterAll(() => closeTestDatabase());

describe('начисление первой линии', () => {
  it('идёт рефереру по ставке из настроек', async () => {
    const code = await givenClient(1n);
    await givenClient(2n, code);

    await givenCompletedRequest(2n, '1000');

    // 5% от дохода в 1000 — 50.
    const account = await core.getBonusAccount(asClient(1n));
    expect(account.balance).toBe('50');
  });

  it('считается от дохода по заявке, а не от её суммы', async () => {
    const code = await givenClient(1n);
    await givenClient(2n, code);

    // Заявка на 100 000, доход по ней — 1000. Процент от суммы заявки
    // отдал бы рефереру 5000 при заработке сервиса в 1000.
    await givenCompletedRequest(2n, '1000');

    const account = await core.getBonusAccount(asClient(1n));
    expect(account.balance).toBe('50');
  });

  it('сохраняет ставку линии и заявку, за которую начислено', async () => {
    const code = await givenClient(1n);
    await givenClient(2n, code);

    const requestId = await givenCompletedRequest(2n, '1000');

    const account = await core.getBonusAccount(asClient(1n));
    expect(account.history).toEqual([
      expect.objectContaining({
        kind: 'accrual',
        amount: '50',
        line: 1,
        rateBps: 500,
        exchangeRequestId: requestId,
      }),
    ]);
  });

  it('сообщается рефереру', async () => {
    const code = await givenClient(1n);
    await givenClient(2n, code);

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

    const { notifications } = await core.completeExchangeRequest(manager, request.id, {
      serviceIncome: '1000',
      serviceIncomeCode: 'RUB',
    });

    expect(notifications).toContainEqual({
      kind: 'bonus-accrued',
      to: 1n,
      line: 1,
      amount: '50',
    });
  });
});

describe('начисление второй линии', () => {
  it('идёт рефереру реферера по своей ставке', async () => {
    const first = await givenClient(1n);
    const second = await givenClient(2n, first);
    await givenClient(3n, second);

    await givenCompletedRequest(3n, '1000');

    // 5% первой линии и 2% второй от одного и того же дохода.
    expect((await core.getBonusAccount(asClient(2n))).balance).toBe('50');
    expect((await core.getBonusAccount(asClient(1n))).balance).toBe('20');
  });

  it('не уходит дальше второй линии', async () => {
    const first = await givenClient(1n);
    const second = await givenClient(2n, first);
    const third = await givenClient(3n, second);
    await givenClient(4n, third);

    await givenCompletedRequest(4n, '1000');

    expect((await core.getBonusAccount(asClient(1n))).balance).toBe('0');
  });
});

describe('заявка клиента без реферера', () => {
  it('никому ничего не начисляет', async () => {
    await givenClient(1n);

    const { request } = await core.submitExchangeRequest(asClient(1n), {
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

    const { notifications } = await core.completeExchangeRequest(manager, request.id, {
      serviceIncome: '1000',
      serviceIncomeCode: 'RUB',
    });

    expect(notifications.filter((one) => one.kind === 'bonus-accrued')).toEqual([]);
    expect((await core.getBonusAccount(asClient(1n))).history).toEqual([]);
  });
});

describe('повторное исполнение', () => {
  it('не создаёт второго начисления по той же заявке', async () => {
    const code = await givenClient(1n);
    await givenClient(2n, code);
    const requestId = await givenCompletedRequest(2n, '1000');

    // Исполненная заявка дальше не переходит, но защита от второго
    // начисления не должна на это опираться: ограничение базы держит
    // его и там, где до таблицы переходов дело не дошло.
    await core
      .completeExchangeRequest(manager, requestId, {
        serviceIncome: '1000',
        serviceIncomeCode: 'RUB',
      })
      .catch(() => undefined);

    const account = await core.getBonusAccount(asClient(1n));
    expect(account.history).toHaveLength(1);
    expect(account.balance).toBe('50');
  });
});

describe('каждая исполненная заявка реферала', () => {
  it('начисляет рефереру заново, а не только первая', async () => {
    const code = await givenClient(1n);
    await givenClient(2n, code);

    await givenCompletedRequest(2n, '1000');
    await givenCompletedRequest(2n, '2000');

    const account = await core.getBonusAccount(asClient(1n));
    expect(account.balance).toBe('150');
    expect(account.history).toHaveLength(2);
  });
});
