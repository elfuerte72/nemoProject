import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, NotFoundError, type Actor } from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Журнал доступа к реквизитам.
 *
 * Восстановить задним числом, кто и когда видел чужой номер карты,
 * невозможно, поэтому запись должна быть непропускаемой: она идёт в той
 * же транзакции, что и чтение. Проверяется это единственным доступным
 * способом — тем, что записи не появляется ровно тогда, когда чтения не
 * было.
 */

const keys = generateRequisiteKeyPair();
const core = createCore({
  db: testDatabase(),
  requisites: { publicKey: keys.publicKey, privateKey: keys.privateKey },
});

const CARD = '4111111111111111';

let manager: Actor & { type: 'staff' };
let admin: Actor & { type: 'staff' };

/** Заявка клиента с приложенными реквизитами. */
async function givenRequestWithCard(): Promise<string> {
  const requisites = await core.saveRequisites(asClient(100n), {
    bankName: 'Сбер',
    cardNumber: CARD,
  });
  const { request } = await core.submitExchangeRequest(asClient(100n), {
    kind: 'electronic',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '1000',
    requisitesId: requisites.id,
  });
  return request.id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await core.registerClient({ telegramUserId: 100n });
  manager = await givenStaff({ displayName: 'Пётр' });
  admin = await givenStaff({ role: 'admin' });
});

afterAll(() => closeTestDatabase());

describe('чтение реквизитов менеджером', () => {
  it('открывает полный номер карты', async () => {
    const requestId = await givenRequestWithCard();

    const revealed = await core.revealRequisites(manager, requestId);

    expect(revealed).toMatchObject({ cardNumber: CARD, cardLast4: '1111', bankName: 'Сбер' });
  });

  it('оставляет в журнале след с сотрудником и заявкой', async () => {
    const requestId = await givenRequestWithCard();

    await core.revealRequisites(manager, requestId);

    expect(await core.listRequisiteAccessLog(admin)).toEqual([
      expect.objectContaining({
        staffId: manager.staffId,
        staffName: 'Пётр',
        clientId: 100n,
        exchangeRequestId: requestId,
        accessedAt: expect.any(Date),
      }),
    ]);
  });

  it('без чтения записи не появляется', async () => {
    await givenRequestWithCard();

    expect(await core.listRequisiteAccessLog(admin)).toEqual([]);
  });

  it('пишет по записи на каждое чтение, а не одну на заявку', async () => {
    const requestId = await givenRequestWithCard();

    await core.revealRequisites(manager, requestId);
    await core.revealRequisites(manager, requestId);

    expect(await core.listRequisiteAccessLog(admin)).toHaveLength(2);
  });

  it('не даётся клиенту', async () => {
    const requestId = await givenRequestWithCard();

    await expect(core.revealRequisites(asClient(100n), requestId)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('не даётся менеджеру, который ведёт не эту заявку', async () => {
    const requestId = await givenRequestWithCard();
    await core.claimExchangeRequest(manager, requestId);
    const colleague = await givenStaff();

    await expect(core.revealRequisites(colleague, requestId)).rejects.toThrow(ForbiddenError);
  });

  it('отказывает по заявке без реквизитов', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'EUR', kind: 'cash' });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'EUR',
      fromAmount: '1000',
    });

    await expect(core.revealRequisites(manager, request.id)).rejects.toThrow(NotFoundError);
  });
});

describe('журнал', () => {
  it('менеджеру не доступен: за ним он и ведётся', async () => {
    const requestId = await givenRequestWithCard();
    await core.revealRequisites(manager, requestId);

    await expect(core.listRequisiteAccessLog(manager)).rejects.toThrow(ForbiddenError);
  });

  it('отбирается по сотруднику', async () => {
    const requestId = await givenRequestWithCard();
    const colleague = await givenStaff({ displayName: 'Анна' });
    await core.revealRequisites(manager, requestId);
    await core.revealRequisites(colleague, requestId);

    const mine = await core.listRequisiteAccessLog(admin, { staffId: manager.staffId });

    expect(mine.map((entry) => entry.staffName)).toEqual(['Пётр']);
  });

  it('отбирается по клиенту', async () => {
    const requestId = await givenRequestWithCard();
    await core.revealRequisites(manager, requestId);

    expect(await core.listRequisiteAccessLog(admin, { clientId: 100n })).toHaveLength(1);
    expect(await core.listRequisiteAccessLog(admin, { clientId: 999n })).toEqual([]);
  });

  it('отбирается по периоду', async () => {
    const requestId = await givenRequestWithCard();
    await core.revealRequisites(manager, requestId);

    const future = new Date(Date.now() + 60_000);
    expect(await core.listRequisiteAccessLog(admin, { from: future })).toEqual([]);
    expect(await core.listRequisiteAccessLog(admin, { to: future })).toHaveLength(1);
  });
});
