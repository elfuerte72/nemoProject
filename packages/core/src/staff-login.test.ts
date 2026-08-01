import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair, totpCode } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError } from './index.js';
import { disableStaff, givenStaff } from './test-support.js';

/**
 * Вход сотрудника в админ-панель.
 *
 * Telegram Login подтверждает только владение аккаунтом — этого мало:
 * за админкой лежат чужие номера карт. Допуск даёт список сотрудников,
 * а сессию — второй фактор. Отказ во всех случаях одинаков: разные
 * ответы на «не сотрудник» и «неверный код» подсказывали бы
 * подбирающему, на каком он шаге.
 */

const keys = generateRequisiteKeyPair();
const core = createCore({
  db: testDatabase(),
  requisites: { publicKey: keys.publicKey, privateKey: keys.privateKey },
});

beforeEach(() => resetDatabase());
afterAll(() => closeTestDatabase());

describe('допуск', () => {
  it('не даётся тому, кого нет в списке сотрудников', async () => {
    await expect(core.beginStaffLogin(555n)).rejects.toThrow(ForbiddenError);
  });

  it('не даётся отключённому сотруднику', async () => {
    const staff = await givenStaff({ telegramUserId: 777n });
    await disableStaff(staff.staffId);

    await expect(core.beginStaffLogin(777n)).rejects.toThrow(ForbiddenError);
  });

  it('не сообщает, чем именно отказ отличается от другого отказа', async () => {
    const staff = await givenStaff({ telegramUserId: 777n });
    await disableStaff(staff.staffId);

    const unknown = await core.beginStaffLogin(555n).catch((error: Error) => error.message);
    const disabled = await core.beginStaffLogin(777n).catch((error: Error) => error.message);

    expect(unknown).toBe(disabled);
  });
});

describe('второй фактор', () => {
  it('настраивается при первом входе: секрет выдаётся один раз', async () => {
    await givenStaff({ telegramUserId: 777n });

    const first = await core.beginStaffLogin(777n);
    const second = await core.beginStaffLogin(777n);

    expect(first.enrollmentSecret).toMatch(/^[A-Z2-7]+$/);
    expect(second.enrollmentSecret).toBeUndefined();
  });

  it('не выдаёт сессию без кода', async () => {
    await givenStaff({ telegramUserId: 777n });
    const { staffId } = await core.beginStaffLogin(777n);

    await expect(core.completeStaffLogin(staffId, '000000')).rejects.toThrow(ForbiddenError);
  });

  it('выдаёт сессию по коду из приложения-аутентификатора', async () => {
    await givenStaff({ telegramUserId: 777n, role: 'admin' });
    const { staffId, enrollmentSecret } = await core.beginStaffLogin(777n);

    const session = await core.completeStaffLogin(staffId, totpCode(enrollmentSecret!));

    expect(session).toEqual({ staffId, role: 'admin' });
  });

  it('не принимает код у сотрудника, отключённого между шагами входа', async () => {
    await givenStaff({ telegramUserId: 777n });
    const { staffId, enrollmentSecret } = await core.beginStaffLogin(777n);
    await disableStaff(staffId);

    await expect(
      core.completeStaffLogin(staffId, totpCode(enrollmentSecret!)),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('действующая сессия', () => {
  it('перестаёт действовать, как только сотрудника отключили', async () => {
    const staff = await givenStaff({ telegramUserId: 777n });

    expect(await core.getActiveStaff(staff.staffId)).toEqual({
      staffId: staff.staffId,
      role: 'manager',
    });

    await disableStaff(staff.staffId);

    await expect(core.getActiveStaff(staff.staffId)).rejects.toThrow(ForbiddenError);
  });

  it('не действует для сотрудника, которого нет', async () => {
    await expect(core.getActiveStaff(crypto.randomUUID())).rejects.toThrow(ForbiddenError);
  });
});
