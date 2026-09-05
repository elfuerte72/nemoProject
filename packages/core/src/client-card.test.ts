import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Карточка клиента глазами сотрудника: с кем он имеет дело.
 *
 * До этого карточка отвечала только «как его зовут и кто привёл», и
 * менеджер, отвечая в переписке, не знал, работали ли с человеком
 * вообще. Числа в ней — те же, что в списке клиентов: два счёта одних
 * и тех же заявок разошлись бы при первой правке.
 *
 * Ожидания посчитаны руками от ставок по умолчанию, а не тем же
 * выражением, что в коде.
 */

const core = createCore({ db: testDatabase() });

let manager: Actor & { type: 'staff' };

async function givenClient(telegramUserId: bigint, referralCode?: string): Promise<string> {
  const { client } = await core.registerClient({
    telegramUserId,
    ...(referralCode === undefined ? {} : { referralCode }),
  });
  return client.referralCode;
}

/** Заявка клиента, доведённая до названного исхода. */
async function givenRequest(
  clientId: bigint,
  fate: 'completed' | 'cancelled' | 'open',
  fromCode = 'USDT',
  fromAmount = '100',
): Promise<void> {
  const { request } = await core.submitExchangeRequest(asClient(clientId), {
    kind: 'cash',
    fromCode,
    toCode: fromCode === 'USDT' ? 'RUB' : 'USDT',
    fromAmount,
  });
  if (fate === 'open') return;
  await core.claimExchangeRequest(manager, request.id);
  await core.confirmExchangeRate(manager, request.id, {
    finalRate: '95',
    toAmount: '1',
    paymentInstructions: 'наличными в офисе',
  });
  if (fate === 'cancelled') {
    await core.cancelExchangeRequest(manager, request.id, { reason: 'Не пришёл' });
    return;
  }
  await core.markPaymentReceived(manager, request.id);
  await core.completeExchangeRequest(manager, request.id, {
    serviceIncome: '1000',
    serviceIncomeCode: 'RUB',
  });
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'cash' });
  manager = await givenStaff({ displayName: 'Пётр' });
});

afterAll(() => closeTestDatabase());

describe('заявки клиента в карточке', () => {
  it('считает исполненные, отменённые и те, что в работе', async () => {
    await givenClient(100n);
    await givenRequest(100n, 'completed');
    await givenRequest(100n, 'completed');
    await givenRequest(100n, 'cancelled');
    await givenRequest(100n, 'open');

    const { stats } = await core.getClientCard(manager, 100n);

    expect(stats.completed).toBe(2);
    expect(stats.cancelled).toBe(1);
    expect(stats.open).toBe(1);
    expect(stats.lastRequestAt).not.toBeNull();
  });

  it('считает оборот по валютам раздельно и только по исполненным', async () => {
    await givenClient(100n);
    await givenRequest(100n, 'completed', 'USDT', '100');
    await givenRequest(100n, 'completed', 'RUB', '5000');
    await givenRequest(100n, 'cancelled', 'USDT', '999');

    const { stats } = await core.getClientCard(manager, 100n);

    expect(stats.turnover).toEqual([
      { code: 'RUB', amount: '5000', count: 1 },
      { code: 'USDT', amount: '100', count: 1 },
    ]);
  });

  it('называет постоянным ровно от трёх исполненных — как список клиентов', async () => {
    await givenClient(100n);
    await givenRequest(100n, 'completed');
    await givenRequest(100n, 'completed');

    expect((await core.getClientCard(manager, 100n)).stats.regular).toBe(false);

    await givenRequest(100n, 'completed');

    expect((await core.getClientCard(manager, 100n)).stats.regular).toBe(true);
  });

  it('у клиента без заявок молчит нулями, а не отсутствием карточки', async () => {
    await givenClient(100n);

    const { stats } = await core.getClientCard(manager, 100n);

    expect(stats.completed).toBe(0);
    expect(stats.turnover).toEqual([]);
    expect(stats.lastRequestAt).toBeNull();
    expect(stats.regular).toBe(false);
  });
});

describe('рефералы клиента в карточке', () => {
  it('считает приведённых по линиям раздельно', async () => {
    const first = await givenClient(100n);
    const second = await givenClient(200n, first);
    await givenClient(300n, first);
    // Пришедший по ссылке приведённого — вторая линия пригласившего.
    await givenClient(400n, second);

    const { stats } = await core.getClientCard(manager, 100n);

    expect(stats.invitedLine1).toBe(2);
    expect(stats.invitedLine2).toBe(1);
  });

  it('называет заработанное реферальной программой за всё время', async () => {
    const code = await givenClient(100n);
    await givenClient(200n, code);

    await givenRequest(200n, 'completed');

    // 5% от дохода в 1000 — 50.
    const { stats } = await core.getClientCard(manager, 100n);
    expect(stats.referralEarned).toBe('50');
  });

  it('никого не приведшему называет нули, а не пустоту', async () => {
    await givenClient(100n);

    const { stats } = await core.getClientCard(manager, 100n);

    expect(stats.invitedLine1).toBe(0);
    expect(stats.invitedLine2).toBe(0);
    expect(stats.referralEarned).toBe('0');
  });
});

describe('ожидание ответа в карточке', () => {
  it('поднимается, пока последнее сообщение — от клиента', async () => {
    await givenClient(100n);
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Здравствуйте' });

    expect((await core.getClientCard(manager, 100n)).stats.waiting).toBe(true);

    await core.replyToClient(manager, { clientId: 100n, body: 'Здравствуйте! Чем помочь?' });

    expect((await core.getClientCard(manager, 100n)).stats.waiting).toBe(false);
  });
});
