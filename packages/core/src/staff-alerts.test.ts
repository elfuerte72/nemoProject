import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seal } from '@nemo/crypto';
import { withdrawalRequests } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenServiceSettings,
  givenStaff,
  testRequisiteKeys,
} from './test-support.js';

/**
 * О чём сотрудникам ещё не сообщали.
 *
 * До этой операции сотруднику приходило ровно одно уведомление — о
 * сообщении клиента. Новая заявка на обмен, вывод и карту не сообщалась
 * никак: увидеть её можно было только на открытом экране, и поданная
 * ночью лежала до утра.
 *
 * Отметка о рассылке ставится тем же условным изменением, что и
 * порождает уведомления: два наложившихся вызова планировщика иначе
 * разошлют одну заявку дважды.
 */

const db = testDatabase();
const core = createCore({ db });

/** Telegram сотрудников: `to` уведомления — их идентификатор, а не строка штата. */
const MANAGER_TG = 901n;
const SECOND_MANAGER_TG = 902n;
const ADMIN_TG = 903n;

let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  await core.registerClient({ telegramUserId: 100n, username: 'ivan' });
  manager = await givenStaff({ displayName: 'Пётр', telegramUserId: MANAGER_TG });
});

afterAll(() => closeTestDatabase());

/** Наличная заявка: у неё нет курса, и источник котировок тесту не нужен. */
async function givenExchangeRequest(): Promise<void> {
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenServiceSettings({ minExchangeAmount: '0' });
  await core.submitExchangeRequest(asClient(100n), {
    kind: 'cash',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100',
  });
}

describe('новая заявка на обмен', () => {
  it('сообщается каждому активному сотруднику', async () => {
    await givenStaff({ displayName: 'Анна', telegramUserId: SECOND_MANAGER_TG });
    await givenExchangeRequest();

    const alerts = (await core.takeStaffAlerts(new Date())).filter(
      (one) => one.kind === 'staff-new-request',
    );

    expect(alerts.map((one) => one.to).sort()).toEqual([MANAGER_TG, SECOND_MANAGER_TG]);
    expect(alerts[0]).toMatchObject({
      clientId: 100n,
      clientUsername: 'ivan',
      request: { kind: 'exchange', fromAmount: '100', fromCode: 'USDT', toCode: 'RUB' },
    });
  });

  it('не повторяется вторым вызовом', async () => {
    await givenExchangeRequest();

    const first = await core.takeStaffAlerts(new Date());
    const second = await core.takeStaffAlerts(new Date());

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('не уходит уволенному сотруднику', async () => {
    const admin = await givenStaff({ role: 'admin', telegramUserId: ADMIN_TG });
    await core.setStaffActive(admin, manager.staffId, false);
    await givenExchangeRequest();

    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts.map((one) => one.to)).toEqual([ADMIN_TG]);
  });
});

describe('новая заявка на вывод', () => {
  it('сообщается сотрудникам', async () => {
    // Баллов у клиента нет, и подать вывод операцией он не может:
    // проверяется рассылка, а не начисление, — поэтому сцену ставит
    // прямая вставка, как и остальные фикстуры.
    await db.insert(withdrawalRequests).values({
      clientId: 100n,
      amount: '500',
      method: 'bank',
      destinationSealed: seal(testRequisiteKeys.publicKey, '2202200000001234'),
      destinationHint: 'Сбербанк ···1234',
    });

    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'staff-new-request',
      to: MANAGER_TG,
      request: { kind: 'withdrawal', amount: '500' },
    });
  });
});

describe('новая заявка на карту', () => {
  it('сообщается сотрудникам', async () => {
    await core.submitCardApplication(asClient(100n));

    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'staff-new-request', request: { kind: 'card' } });
  });
});

describe('обращения клиентов', () => {
  it('приходят той же операцией: у планировщика один вызов, а не четыре', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });

    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts).toEqual([
      expect.objectContaining({ kind: 'staff-client-message', to: MANAGER_TG }),
    ]);
  });

  it('уходят каждому активному сотруднику', async () => {
    await givenStaff({ displayName: 'Анна', telegramUserId: SECOND_MANAGER_TG });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });

    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts.map((one) => one.to).sort()).toEqual([MANAGER_TG, SECOND_MANAGER_TG]);
  });

  it('не повторяются вторым вызовом', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });

    const first = await core.takeStaffAlerts(new Date());
    const second = await core.takeStaffAlerts(new Date());

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('не возникают на повторные сообщения того же клиента до ответа', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Первый' });
    await core.takeStaffAlerts(new Date());
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Второй' });

    expect(await core.takeStaffAlerts(new Date())).toEqual([]);
  });

  it('не уходят уволенному сотруднику', async () => {
    const admin = await givenStaff({ role: 'admin', telegramUserId: ADMIN_TG });
    await core.setStaffActive(admin, manager.staffId, false);
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });

    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts.map((one) => one.to)).toEqual([ADMIN_TG]);
  });
});

describe('тишина', () => {
  it('не порождает уведомлений, когда сообщать не о чем', async () => {
    expect(await core.takeStaffAlerts(new Date())).toEqual([]);
  });
});
