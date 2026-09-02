import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import { asClient, givenCurrencyPair, givenStaff, testRequisiteKeys } from './test-support.js';

/**
 * Список клиентов: оборот только по исполненным и по валютам раздельно,
 * «постоянный» ровно от трёх, поиск по ID точный и по нику подстрокой,
 * курсор без дублей, ждущие ответа.
 */

const core = createCore({
  db: testDatabase(),
  requisites: {
    publicKey: testRequisiteKeys.publicKey,
    privateKey: testRequisiteKeys.privateKey,
  },
});

let manager: Actor & { type: 'staff' };

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
    finalRate: '80',
    toAmount: '1',
    paymentInstructions: 'У кассы',
  });
  if (fate === 'completed') {
    await core.markPaymentReceived(manager, request.id);
    await core.completeExchangeRequest(manager, request.id, {
      serviceIncome: '1',
      serviceIncomeCode: fromCode,
    });
  } else {
    await core.cancelExchangeRequest(manager, request.id, { reason: 'Не пришёл' });
  }
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'cash' });
  await core.registerClient({ telegramUserId: 100n, username: 'elfuerte' });
  await core.registerClient({ telegramUserId: 200n, username: 'petrov' });
  await core.registerClient({ telegramUserId: 300n });
  manager = await givenStaff({ displayName: 'Пётр' });
});

afterAll(() => closeTestDatabase());

describe('список клиентов', () => {
  it('оборот — только по исполненным и по валютам раздельно', async () => {
    await givenRequest(100n, 'completed', 'USDT', '100');
    await givenRequest(100n, 'completed', 'RUB', '5000');
    await givenRequest(100n, 'cancelled', 'USDT', '999');
    await givenRequest(100n, 'open', 'USDT', '70');

    const [row] = await core.listClients(manager, { query: '100' });

    expect(row?.completed).toBe(2);
    expect(row?.cancelled).toBe(1);
    expect(row?.open).toBe(1);
    expect(row?.turnover).toEqual([
      { code: 'RUB', amount: '5000', count: 1 },
      { code: 'USDT', amount: '100', count: 1 },
    ]);
    expect(row?.lastRequestAt).not.toBeNull();
  });

  it('постоянный — ровно от трёх исполненных', async () => {
    await givenRequest(100n, 'completed');
    await givenRequest(100n, 'completed');
    await givenRequest(200n, 'completed');
    await givenRequest(200n, 'completed');
    await givenRequest(200n, 'completed');

    const regular = await core.listClients(manager, { tab: 'regular' });
    expect(regular.map((one) => one.telegramUserId)).toEqual([200n]);
    expect(regular[0]?.regular).toBe(true);

    const all = await core.listClients(manager);
    expect(all.find((one) => one.telegramUserId === 100n)?.regular).toBe(false);
    expect((await core.summarizeClients(manager)).regular).toBe(1);
  });

  it('поиск по ID точный, по нику — подстрокой и без собаки', async () => {
    expect((await core.listClients(manager, { query: '10' })).length).toBe(0);
    expect((await core.listClients(manager, { query: '100' })).length).toBe(1);
    expect(
      (await core.listClients(manager, { query: '@fuer' })).map((one) => one.username),
    ).toEqual(['elfuerte']);
    expect(await core.countClients(manager, { query: 'e' })).toBe(2);
  });

  it('ждущие ответа — те, чьё последнее сообщение без ответа', async () => {
    await core.receiveClientMessage({ telegramUserId: 200n, body: 'Здравствуйте' });
    await core.receiveClientMessage({ telegramUserId: 300n, body: 'Вопрос' });
    await core.replyToClient(manager, { clientId: 300n, body: 'Отвечаю' });

    const waiting = await core.listClients(manager, { tab: 'waiting' });
    expect(waiting.map((one) => one.telegramUserId)).toEqual([200n]);
    expect(waiting[0]?.waiting).toBe(true);
    expect((await core.summarizeClients(manager)).waiting).toBe(1);
  });

  it('курсор дочитывает без дублей', async () => {
    const first = await core.listClients(manager, { limit: 2 });
    const last = first[first.length - 1]!;
    const second = await core.listClients(manager, {
      limit: 2,
      after: { createdAt: last.createdAt, id: last.telegramUserId },
    });
    const ids = [...first, ...second].map((one) => one.telegramUserId);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toHaveLength(3);
  });

  it('заявки клиента — новые сверху, с именем ведущего', async () => {
    await givenRequest(100n, 'completed');
    await givenRequest(100n, 'open');
    const rows = await core.listClientExchangeRequests(manager, 100n);
    expect(rows.map((one) => one.status)).toEqual(['new', 'completed']);
    expect(rows[1]?.assignedManagerName).toBe('Пётр');
  });
});
