import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair, totpCode } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  ConflictError,
  createCore,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  type Actor,
} from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Раздел администратора: сотрудники и экономика сервиса.
 *
 * Главная проверка здесь — что смена ставок не переписывает прошлое.
 * Начисление сделано на тех условиях, которые действовали в момент
 * исполнения заявки, и новая ставка линии к исполненной заявке отношения не
 * имеет.
 */

const keys = generateRequisiteKeyPair();
const core = createCore({
  db: testDatabase(),
  requisites: { publicKey: keys.publicKey, privateKey: keys.privateKey },
});

let admin: Actor & { type: 'staff' };
let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  admin = await givenStaff({ role: 'admin', displayName: 'Владелец' });
  manager = await givenStaff({ role: 'manager' });
});

afterAll(() => closeTestDatabase());

describe('сотрудники', () => {
  it('заводятся администратором вместе со вторым фактором', async () => {
    const { staff, enrollmentSecret } = await core.addStaff(admin, {
      telegramUserId: 555n,
      displayName: 'Анна',
      role: 'manager',
    });

    expect(staff).toMatchObject({
      telegramUserId: 555n,
      displayName: 'Анна',
      role: 'manager',
      isActive: true,
      hasSecondFactor: true,
    });
    // Секретом сотрудник сразу может войти — иначе выдавать его незачем.
    const session = await core.beginStaffLogin(555n);
    await expect(
      core.completeStaffLogin(session.staffId, totpCode(enrollmentSecret)),
    ).resolves.toMatchObject({ role: 'manager' });
  });

  it('не заводятся дважды на один Telegram', async () => {
    await core.addStaff(admin, { telegramUserId: 555n, displayName: 'Анна' });

    await expect(
      core.addStaff(admin, { telegramUserId: 555n, displayName: 'Другая Анна' }),
    ).rejects.toThrow(ConflictError);
  });

  it('меняют роль по решению администратора', async () => {
    const { staff } = await core.addStaff(admin, {
      telegramUserId: 555n,
      displayName: 'Анна',
    });

    const updated = await core.updateStaffRole(admin, staff.id, 'admin');

    expect(updated.role).toBe('admin');
  });

  it('теряют доступ немедленно после отключения', async () => {
    const { staff } = await core.addStaff(admin, {
      telegramUserId: 555n,
      displayName: 'Анна',
    });

    await core.setStaffActive(admin, staff.id, false);

    await expect(core.getActiveStaff(staff.id)).rejects.toThrow(ForbiddenError);
    await expect(core.beginStaffLogin(555n)).rejects.toThrow(ForbiddenError);
  });

  it('не дают администратору отключить самого себя', async () => {
    await expect(core.setStaffActive(admin, admin.staffId, false)).rejects.toThrow(
      InvalidInputError,
    );
  });

  it('получают новый второй фактор от администратора, и прежний перестаёт работать', async () => {
    const first = await core.addStaff(admin, { telegramUserId: 555n, displayName: 'Анна' });
    const { staffId } = await core.beginStaffLogin(555n);

    const second = await core.resetStaffSecondFactor(admin, staffId);

    expect(second.enrollmentSecret).not.toBe(first.enrollmentSecret);
    await expect(
      core.completeStaffLogin(staffId, totpCode(first.enrollmentSecret)),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      core.completeStaffLogin(staffId, totpCode(second.enrollmentSecret)),
    ).resolves.toMatchObject({ staffId });
  });
});

describe('последний администратор', () => {
  /*
   * Первого администратора заводит `create-first-admin`, и только на
   * пустом списке сотрудников; до 17 сентября 2026 единственный
   * администратор снимал с себя роль одним нажатием, и вернуть её можно
   * было только правкой базы.
   */
  const LAST_ADMIN = /ни одного действующего администратора/;

  async function roles(): Promise<Record<string, string>> {
    const all = await core.listStaff(admin);
    return Object.fromEntries(all.map((one) => [one.displayName, `${one.role}:${one.isActive}`]));
  }

  it('не снимает роль с единственного администратора', async () => {
    const refusal = core.updateStaffRole(admin, admin.staffId, 'manager');

    await expect(refusal).rejects.toThrow(InvalidInputError);
    await expect(refusal).rejects.toThrow(LAST_ADMIN);
    expect((await roles())['Владелец']).toBe('admin:true');
  });

  it('снимает роль, если остаётся другой действующий администратор', async () => {
    const { staff: anna } = await core.addStaff(admin, {
      telegramUserId: 555n,
      displayName: 'Анна',
      role: 'admin',
    });

    await core.updateStaffRole(admin, admin.staffId, 'manager');

    expect(anna.role).toBe('admin');
    expect(await roles()).toMatchObject({ Владелец: 'manager:true', Анна: 'admin:true' });
  });

  it('не считает администратора с закрытым доступом', async () => {
    const { staff: anna } = await core.addStaff(admin, {
      telegramUserId: 555n,
      displayName: 'Анна',
      role: 'admin',
    });
    await core.setStaffActive(admin, anna.id, false);

    await expect(core.updateStaffRole(admin, admin.staffId, 'manager')).rejects.toThrow(
      LAST_ADMIN,
    );
  });

  it('не закрывает доступ последнему действующему администратору', async () => {
    // Двое администраторов закрывают доступ друг другу: первый успел
    // снять роль с себя, второй — по прежней сессии, где первый ещё
    // администратор, — закрывает доступ единственному оставшемуся.
    const second = await givenStaff({ role: 'admin', displayName: 'Анна' });
    await core.updateStaffRole(admin, admin.staffId, 'manager');

    const refusal = core.setStaffActive(admin, second.staffId, false);

    await expect(refusal).rejects.toThrow(InvalidInputError);
    await expect(refusal).rejects.toThrow(LAST_ADMIN);
    expect((await roles())['Анна']).toBe('admin:true');
  });

  it('снятые разом друг другом, оставляют одного', async () => {
    const second = await givenStaff({ role: 'admin', displayName: 'Анна' });

    const results = await Promise.allSettled([
      core.updateStaffRole(admin, second.staffId, 'manager'),
      core.updateStaffRole(second, admin.staffId, 'manager'),
    ]);

    expect(results.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
    const admins = (await core.listStaff(admin)).filter((one) => one.role === 'admin');
    expect(admins).toHaveLength(1);
  });

  it('не мешает менять роль и доступ менеджерам', async () => {
    await core.updateStaffRole(admin, manager.staffId, 'manager');
    await core.setStaffActive(admin, manager.staffId, false);

    expect((await roles())['Менеджер']).toBe('manager:false');
  });
});

describe('второй фактор из консоли сервера', () => {
  it('выдаётся заново без администратора: иначе войти, чтобы починить вход, нельзя', async () => {
    const first = await core.addStaff(admin, { telegramUserId: 555n, displayName: 'Анна' });
    const { staffId } = await core.beginStaffLogin(555n);

    const second = await core.reissueSecondFactorFromConsole(555n);

    await expect(
      core.completeStaffLogin(staffId, totpCode(first.enrollmentSecret)),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      core.completeStaffLogin(staffId, totpCode(second.enrollmentSecret)),
    ).resolves.toMatchObject({ staffId });
  });

  it('отказывает на незнакомом Telegram, а не заводит сотрудника молча', async () => {
    await expect(core.reissueSecondFactorFromConsole(404n)).rejects.toThrow(NotFoundError);
  });
});

describe('подпись записи в аутентификаторе', () => {
  it('несёт Telegram и роль: одним «nemo» две записи в приложении не различить', async () => {
    const { otpauthUri } = await core.addStaff(admin, {
      telegramUserId: 555n,
      displayName: 'Анна',
      role: 'manager',
    });

    expect(decodeURIComponent(otpauthUri)).toContain('nemo:555 · manager');
  });
});

describe('первый администратор', () => {
  it('заводится, пока сотрудников нет, и больше никогда', async () => {
    await resetDatabase();

    const first = await core.enrollFirstAdmin({
      telegramUserId: 999n,
      displayName: 'Владелец',
    });

    expect(first.staff.role).toBe('admin');
    await expect(
      core.enrollFirstAdmin({ telegramUserId: 998n, displayName: 'Второй' }),
    ).rejects.toThrow(ConflictError);
  });
});

describe('раздел настроек', () => {
  it('менеджеру не доступен', async () => {
    await expect(core.getServiceSettings(manager)).rejects.toThrow(ForbiddenError);
    await expect(core.listStaff(manager)).rejects.toThrow(ForbiddenError);
    await expect(
      core.updateServiceSettings(manager, { markupBps: 100 }),
    ).rejects.toThrow(ForbiddenError);
    await expect(core.listSettingsAuditLog(manager)).rejects.toThrow(ForbiddenError);
  });

  it('клиенту не доступен тем более', async () => {
    await core.registerClient({ telegramUserId: 100n });

    await expect(core.getServiceSettings(asClient(100n))).rejects.toThrow(ForbiddenError);
  });

  /*
   * Наценка — исключение: по ней панель подсказывает менеджеру доход по
   * заявке, который он иначе считает в уме. Клиент видит ту же величину
   * в котировке, так что секретом она не была никогда.
   */
  it('наценку отдаёт менеджеру, а клиенту — нет', async () => {
    await core.updateServiceSettings(admin, { markupBps: 350 });
    await core.registerClient({ telegramUserId: 100n });

    await expect(core.getServiceMarkupBps(manager)).resolves.toBe(350);
    await expect(core.getServiceMarkupBps(asClient(100n))).rejects.toThrow(ForbiddenError);
  });
});

describe('минимальная сумма вывода', () => {
  it('задаётся администратором', async () => {
    const updated = await core.updateServiceSettings(admin, { minWithdrawalAmount: '2500' });
    expect(updated).toMatchObject({ minWithdrawalAmount: '2500' });
  });

  it('не смешивается с наценкой: правится только названное', async () => {
    await core.updateServiceSettings(admin, { markupBps: 350 });

    const settings = await core.getServiceSettings(admin);

    expect(settings).toMatchObject({ markupBps: 350, minWithdrawalAmount: '1000' });
  });

  it('не принимает отрицательную минимальную сумму вывода', async () => {
    await expect(
      core.updateServiceSettings(admin, { minWithdrawalAmount: '-1' }),
    ).rejects.toThrow(InvalidInputError);
  });
});

describe('экономика сервиса', () => {
  it('задаётся администратором одним набором значений', async () => {
    const updated = await core.updateServiceSettings(admin, {
      markupBps: 350,
      minExchangeAmount: '5000',
      unpaidExchangeRequestTtlMinutes: 90,
    });

    expect(updated).toMatchObject({
      markupBps: 350,
      minExchangeAmount: '5000',
      unpaidExchangeRequestTtlMinutes: 90,
    });
  });

  it('не принимает наценку выше ста процентов', async () => {
    await expect(core.updateServiceSettings(admin, { markupBps: 10_001 })).rejects.toThrow(
      InvalidInputError,
    );
  });

  it('не принимает отрицательную минимальную сумму обмена', async () => {
    await expect(
      core.updateServiceSettings(admin, { minExchangeAmount: '-1' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не принимает нулевой срок жизни заявки: он отменял бы её сразу', async () => {
    await expect(
      core.updateServiceSettings(admin, { unpaidExchangeRequestTtlMinutes: 0 }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('пишет изменение экономики в журнал настроек', async () => {
    await core.updateServiceSettings(admin, { markupBps: 350 });

    const [entry] = await core.listSettingsAuditLog(admin);
    const changes = entry!.changes as {
      before: { markupBps: number };
      after: { markupBps: number };
    };

    expect(entry).toMatchObject({ subject: 'service_settings' });
    expect(changes.before.markupBps).toBe(200);
    expect(changes.after.markupBps).toBe(350);
  });
});

describe('прошлые начисления', () => {
  it('не пересчитываются при смене ставки', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    const { client } = await core.registerClient({ telegramUserId: 1n });
    await core.registerClient({ telegramUserId: 2n, referralCode: client.referralCode });

    async function completeRequest(): Promise<void> {
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
        serviceIncome: '1000',
        serviceIncomeCode: 'RUB',
      });
    }

    await completeRequest();
    await core.updateReferralLines(admin, [
      { line: 1, rateBps: 1000 },
      { line: 2, rateBps: 200 },
    ]);
    await completeRequest();

    // Первая заявка исполнена на 5%, вторая — на 10%: 50 и 100.
    const account = await core.getBonusAccount(asClient(1n));
    expect(account.history.map((one) => ({ amount: one.amount, rateBps: one.rateBps }))).toEqual(
      [
        { amount: '100', rateBps: 1000 },
        { amount: '50', rateBps: 500 },
      ],
    );
    expect(account.balance).toBe('150');
  });
});

describe('журнал изменений', () => {
  it('записывает, кто и когда менял настройки', async () => {
    await core.updateServiceSettings(admin, { markupBps: 700 });

    expect(await core.listSettingsAuditLog(admin)).toEqual([
      expect.objectContaining({
        staffId: admin.staffId,
        staffName: 'Владелец',
        subject: 'service_settings',
        createdAt: expect.any(Date),
      }),
    ]);
  });

  it('хранит, что именно изменилось', async () => {
    await core.updateServiceSettings(admin, { markupBps: 700 });

    const [entry] = await core.listSettingsAuditLog(admin);
    const changes = entry!.changes as { before: { markupBps: number }; after: { markupBps: number } };

    expect(changes.before.markupBps).toBe(200);
    expect(changes.after.markupBps).toBe(700);
  });

  it('записывает и заведение сотрудника, и смену его роли', async () => {
    const { staff } = await core.addStaff(admin, {
      telegramUserId: 555n,
      displayName: 'Анна',
    });
    await core.updateStaffRole(admin, staff.id, 'admin');

    const log = await core.listSettingsAuditLog(admin);

    expect(log.map((entry) => entry.subject)).toEqual(['staff', 'staff']);
    expect(log.every((entry) => entry.subjectId === staff.id)).toBe(true);
  });
});
