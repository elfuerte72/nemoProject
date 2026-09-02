import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import {
  asClient,
  disableStaff,
  givenCurrencyPair,
  givenStaff,
  testRequisiteKeys,
} from './test-support.js';

/**
 * Передача заявки другому менеджеру.
 *
 * Закрепление — правило без обхода даже для администратора: иначе в
 * истории два исполнителя при одном закреплении. Передача — единственный
 * законный путь сменить ведущего, и проверяется здесь, кто может её
 * сделать, кому нельзя передать и что остаётся в истории.
 */

const core = createCore({
  db: testDatabase(),
  requisites: {
    publicKey: testRequisiteKeys.publicKey,
    privateKey: testRequisiteKeys.privateKey,
  },
});

let petr: Actor & { type: 'staff' };
let anna: Actor & { type: 'staff' };
let admin: Actor & { type: 'staff' };

async function givenTakenRequest(by: Actor): Promise<string> {
  const { request } = await core.submitExchangeRequest(asClient(100n), {
    kind: 'cash',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '1000',
  });
  await core.claimExchangeRequest(by, request.id);
  return request.id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await core.registerClient({ telegramUserId: 100n, username: 'elfuerte' });
  petr = await givenStaff({ displayName: 'Пётр' });
  anna = await givenStaff({ displayName: 'Анна' });
  admin = await givenStaff({ displayName: 'Мария', role: 'admin' });
});

afterAll(() => closeTestDatabase());

describe('передача заявки', () => {
  it('ведущий передаёт свою — ведёт другой, и это записано в историю', async () => {
    const id = await givenTakenRequest(petr);

    const { request, notifications } = await core.reassignExchangeRequest(petr, id, {
      toStaffId: anna.staffId,
    });

    expect(request.assignedManagerId).toBe(anna.staffId);
    expect(request.assignedManagerName).toBe('Анна');
    // Клиенту ничего не уходит: его процесс не изменился.
    expect(notifications).toEqual([]);

    const events = await core.listExchangeRequestEvents(anna, id);
    const last = events[events.length - 1];
    expect(last?.comment).toBe('Передана: Пётр → Анна');
    expect(last?.fromStatus).toBe('in_progress');
    expect(last?.toStatus).toBe('in_progress');

    // Дальше по заявке действует новый ведущий, а прежний — нет.
    await expect(core.markPaymentReceived(petr, id)).rejects.toThrow(/другой менеджер/);
    await core.confirmExchangeRate(anna, id, {
      finalRate: '81.5',
      toAmount: '81500',
      paymentInstructions: 'У кассы на Сукхумвит',
    });
  });

  it('чужую заявку менеджер передать не может', async () => {
    const id = await givenTakenRequest(petr);
    await expect(
      core.reassignExchangeRequest(anna, id, { toStaffId: anna.staffId }),
    ).rejects.toThrow(/тот, кто её ведёт, или администратор/);
  });

  it('администратор передаёт любую', async () => {
    const id = await givenTakenRequest(petr);
    const { request } = await core.reassignExchangeRequest(admin, id, {
      toStaffId: anna.staffId,
    });
    expect(request.assignedManagerName).toBe('Анна');
  });

  it('выключенному сотруднику передать нельзя', async () => {
    const id = await givenTakenRequest(petr);
    await disableStaff(anna.staffId);
    await expect(
      core.reassignExchangeRequest(petr, id, { toStaffId: anna.staffId }),
    ).rejects.toThrow(/нет или доступ ему закрыт/);
  });

  it('закрытую и ничью заявку передать нельзя', async () => {
    const closed = await givenTakenRequest(petr);
    await core.cancelExchangeRequest(petr, closed, { reason: 'Клиент передумал' });
    await expect(
      core.reassignExchangeRequest(admin, closed, { toStaffId: anna.staffId }),
    ).rejects.toThrow(/Закрытую/);

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
    });
    await expect(
      core.reassignExchangeRequest(admin, request.id, { toStaffId: anna.staffId }),
    ).rejects.toThrow(/возьмите её в работу/);
  });

  it('самому себе передать нечего', async () => {
    const id = await givenTakenRequest(petr);
    await expect(
      core.reassignExchangeRequest(petr, id, { toStaffId: petr.staffId }),
    ).rejects.toThrow(/уже ведёт/);
  });
});

describe('коллеги для передачи', () => {
  it('менеджер видит имена активных, выключенных — нет', async () => {
    await disableStaff(anna.staffId);
    const names = (await core.listColleagues(petr)).map((one) => one.displayName);
    expect(names).toEqual(['Мария', 'Пётр']);
  });
});
