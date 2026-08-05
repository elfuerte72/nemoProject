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
 * а сессию — второй фактор, выданный администратором заранее. Отказ во
 * всех случаях одинаков: разные ответы на «не сотрудник» и «второй
 * фактор не выдан» подсказывали бы подбирающему, на каком он шаге.
 *
 * Выданный, но ни разу не сработавший ключ вход показывает сам:
 * администратор видел код для камеры, а заносить ключ в приложение не
 * ему, и без этого показа сотрудник упирался в поле для кода, который
 * ему взять неоткуда. Первый сошедшийся код показ закрывает — дальше
 * ключ выдаётся только заново.
 */

const keys = generateRequisiteKeyPair();
const core = createCore({
  db: testDatabase(),
  requisites: { publicKey: keys.publicKey, privateKey: keys.privateKey },
});

/** Сотрудник, которому администратор уже выдал второй фактор. */
async function givenEnrolledStaff(telegramUserId: bigint, role: 'manager' | 'admin' = 'manager') {
  const admin = await core.enrollFirstAdmin({
    telegramUserId: telegramUserId + 1n,
    displayName: 'Первый администратор',
  });
  const actor = { type: 'staff' as const, staffId: admin.staff.id, role: 'admin' as const };
  return core.addStaff(actor, { telegramUserId, displayName: 'Сотрудник', role });
}

beforeEach(() => resetDatabase());
afterAll(() => closeTestDatabase());

describe('допуск', () => {
  it('не даётся тому, кого нет в списке сотрудников', async () => {
    await expect(core.beginStaffLogin(555n)).rejects.toThrow(ForbiddenError);
  });

  it('не даётся отключённому сотруднику', async () => {
    const { staff } = await givenEnrolledStaff(777n);
    await disableStaff(staff.id);

    await expect(core.beginStaffLogin(777n)).rejects.toThrow(ForbiddenError);
  });

  it('не сообщает, чем именно отказ отличается от другого отказа', async () => {
    const { staff } = await givenEnrolledStaff(777n);
    await disableStaff(staff.id);

    const unknown = await core.beginStaffLogin(555n).catch((error: Error) => error.message);
    const disabled = await core.beginStaffLogin(777n).catch((error: Error) => error.message);

    expect(unknown).toBe(disabled);
  });
});

describe('второй фактор', () => {
  it('обязателен: без выданного секрета вход не начинается', async () => {
    // Сотрудник заведён в обход администратора — секрета у него нет.
    // Сам вход его не заводит: секрет, появляющийся при первом входе,
    // отдал бы админку тому, кто угнал аккаунт раньше настоящего
    // сотрудника.
    const staff = await givenStaff({ telegramUserId: 777n });

    await expect(core.beginStaffLogin(777n)).rejects.toThrow(ForbiddenError);
    expect(staff.staffId).toBeTypeOf('string');
  });

  it('не выдаёт сессию без кода', async () => {
    await givenEnrolledStaff(777n);
    const { staffId } = await core.beginStaffLogin(777n);

    await expect(core.completeStaffLogin(staffId, '000000')).rejects.toThrow(ForbiddenError);
  });

  it('выдаёт сессию по коду из приложения-аутентификатора', async () => {
    const enrolled = await givenEnrolledStaff(777n, 'admin');
    const { staffId } = await core.beginStaffLogin(777n);

    const session = await core.completeStaffLogin(
      staffId,
      totpCode(enrolled.enrollmentSecret),
    );

    expect(session).toMatchObject({ staffId, role: 'admin' });
  });

  it('не принимает код у сотрудника, отключённого между шагами входа', async () => {
    const enrolled = await givenEnrolledStaff(777n);
    const { staffId } = await core.beginStaffLogin(777n);
    await disableStaff(staffId);

    await expect(
      core.completeStaffLogin(staffId, totpCode(enrolled.enrollmentSecret)),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('ключ, до которого сотрудник ещё не добрался', () => {
  it('выдаётся ему на входе — тот же самый, что показали администратору', async () => {
    const enrolled = await givenEnrolledStaff(777n);
    const { secondFactorPending, staffId } = await core.beginStaffLogin(777n);

    expect(secondFactorPending).toBe(true);
    const claimed = await core.claimSecondFactor(staffId);
    // Новый ключ обесценил бы код для камеры, уже отданный
    // администратором: сходился бы он только у последнего открывшего вход.
    expect(claimed.enrollmentSecret).toBe(enrolled.enrollmentSecret);
    expect(claimed.otpauthUri).toContain(claimed.enrollmentSecret);
  });

  it('перестаёт выдаваться, как только им один раз вошли', async () => {
    const enrolled = await givenEnrolledStaff(777n);
    const { staffId } = await core.beginStaffLogin(777n);
    await core.completeStaffLogin(staffId, totpCode(enrolled.enrollmentSecret));

    const next = await core.beginStaffLogin(777n);
    expect(next.secondFactorPending).toBe(false);
    await expect(core.claimSecondFactor(staffId)).rejects.toThrow(ForbiddenError);
  });

  it('не выдаётся отключённому сотруднику', async () => {
    const { staff } = await givenEnrolledStaff(777n);
    await disableStaff(staff.id);

    await expect(core.claimSecondFactor(staff.id)).rejects.toThrow(ForbiddenError);
  });

  it('выдаётся снова после того, как администратор выдал ключ заново', async () => {
    const enrolled = await givenEnrolledStaff(777n);
    const { staffId } = await core.beginStaffLogin(777n);
    await core.completeStaffLogin(staffId, totpCode(enrolled.enrollmentSecret));

    // Потерянный телефон: прежний ключ мёртв, а новый до сотрудника
    // доедет тем же путём — через его собственный вход.
    const admin = await core.beginStaffLogin(778n);
    const reissued = await core.resetStaffSecondFactor(
      { type: 'staff', staffId: admin.staffId, role: 'admin' },
      staffId,
    );

    const next = await core.beginStaffLogin(777n);
    expect(next.secondFactorPending).toBe(true);
    expect((await core.claimSecondFactor(staffId)).enrollmentSecret).toBe(
      reissued.enrollmentSecret,
    );
  });
});

describe('действующая сессия', () => {
  it('перестаёт действовать, как только сотрудника отключили', async () => {
    const { staff } = await givenEnrolledStaff(777n);

    expect(await core.getActiveStaff(staff.id)).toMatchObject({
      staffId: staff.id,
      role: 'manager',
    });

    await disableStaff(staff.id);

    await expect(core.getActiveStaff(staff.id)).rejects.toThrow(ForbiddenError);
  });

  it('не действует для сотрудника, которого нет', async () => {
    await expect(core.getActiveStaff(crypto.randomUUID())).rejects.toThrow(ForbiddenError);
  });
});
