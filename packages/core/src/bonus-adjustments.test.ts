import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { InvalidInputError } from './errors.js';
import { createCore } from './index.js';
import { asClient, givenStaff } from './test-support.js';
import type { Actor } from './actor.js';

/**
 * Правка баллов руками: движение вида `adjustment` с комментарием и
 * подписью сотрудника. Ниже нуля счёт не уходит — снятое сверх остатка
 * было бы долгом клиента, которого программа не знает.
 */

const core = createCore({ db: testDatabase() });
let admin: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  admin = await givenStaff({ role: 'admin' });
  await core.registerClient({ telegramUserId: 1n });
});
afterAll(() => closeTestDatabase());

describe('правка баллов', () => {
  it('начисляет и снимает с комментарием, баланс меняется, заработанное нет', async () => {
    await core.adjustBonus(admin, 1n, { amount: '300', comment: 'компенсация за сбой' });
    const snapped = await core.adjustBonus(admin, 1n, { amount: '-100', comment: 'ошибочно' });

    const account = await core.getBonusAccount(asClient(1n));
    expect(account.balance).toBe('200');
    expect(account.earned).toBe('0');
    expect(snapped).toMatchObject({ kind: 'adjustment', amount: '-100', comment: 'ошибочно' });
    expect(account.history.map((one) => one.amount)).toEqual(['-100', '300']);
  });

  it('не снимает больше остатка и не принимает ноль или пустой комментарий', async () => {
    await expect(
      core.adjustBonus(admin, 1n, { amount: '-1', comment: 'минус' }),
    ).rejects.toThrow(/остат/i);
    await expect(core.adjustBonus(admin, 1n, { amount: '0', comment: 'ноль' })).rejects.toThrow(
      InvalidInputError,
    );
    await expect(core.adjustBonus(admin, 1n, { amount: '10', comment: '  ' })).rejects.toThrow(
      /комментари/i,
    );
  });

  it('только администратору и только заведённому клиенту', async () => {
    const manager = await givenStaff();
    await expect(
      core.adjustBonus(manager, 1n, { amount: '10', comment: 'нельзя' }),
    ).rejects.toThrow(/forbidden|Только администратор/i);
    await expect(
      core.adjustBonus(admin, 99n, { amount: '10', comment: 'нет такого' }),
    ).rejects.toThrow(/не найден/i);
  });
});
