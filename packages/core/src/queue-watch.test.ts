import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clientMessages, exchangeRequests } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenServiceSettings,
  givenStaff,
} from './test-support.js';

/**
 * Сторож очереди: что залежалось.
 *
 * Уведомление о новой заявке уходит один раз, и на этом сервис о ней
 * замолкает. Дальше она может простоять час — потому что смена сменилась,
 * потому что сообщение прокрутилось в чате, потому что менеджер решил
 * «возьму через минуту». Заметит это клиент.
 *
 * Правила здесь нарочно тупые: время и состояние, без всякой оценки
 * важности. Сторож, решающий, какая заявка важнее, — это второй продукт,
 * а нужен один вопрос: «об этом уже забыли?»
 */

const db = testDatabase();
const core = createCore({ db });

const MANAGER_TG = 901n;
let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  await core.registerClient({ telegramUserId: 100n, username: 'ivan' });
  manager = await givenStaff({ displayName: 'Пётр', telegramUserId: MANAGER_TG });
});

afterAll(() => closeTestDatabase());

async function givenExchangeRequest(): Promise<string> {
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenServiceSettings({ minExchangeAmount: '0' });
  const { request } = await core.submitExchangeRequest(asClient(100n), {
    kind: 'cash',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100',
  });
  return request.id;
}

/** Состарить всё поданное: столько прошло с тех пор. */
async function aged(minutes: number): Promise<void> {
  const at = new Date(Date.now() - minutes * 60 * 1000);
  await db.update(exchangeRequests).set({ createdAt: at });
  await db.update(clientMessages).set({ createdAt: at });
}

describe('заявка, которую никто не взял', () => {
  it('о ней напоминают, когда она залежалась', async () => {
    await givenExchangeRequest();
    // Первое уведомление уже ушло: сторож напоминает, а не сообщает.
    await core.takeStaffAlerts(new Date());
    await aged(60);

    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts).toEqual([
      expect.objectContaining({ kind: 'staff-stale-request', to: MANAGER_TG }),
    ]);
  });

  it('молчит, пока заявка свежая', async () => {
    await givenExchangeRequest();
    await core.takeStaffAlerts(new Date());

    expect(await core.takeStaffAlerts(new Date())).toEqual([]);
  });

  it('не напоминает дважды об одном', async () => {
    await givenExchangeRequest();
    await core.takeStaffAlerts(new Date());
    await aged(60);

    const first = await core.takeStaffAlerts(new Date());
    const second = await core.takeStaffAlerts(new Date());

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('молчит о взятой в работу: у неё есть хозяин', async () => {
    const id = await givenExchangeRequest();
    await core.takeStaffAlerts(new Date());
    await core.claimExchangeRequest(manager, id);
    await aged(60);

    expect(await core.takeStaffAlerts(new Date())).toEqual([]);
  });
});

describe('клиент, который ждёт ответа', () => {
  it('о нём напоминают, когда ждать он стал долго', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });
    await core.takeStaffAlerts(new Date());
    await aged(60);

    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts).toEqual([
      expect.objectContaining({ kind: 'staff-waiting-client', clientId: 100n }),
    ]);
  });

  it('молчит, если менеджер ответил', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });
    await core.takeStaffAlerts(new Date());
    await core.replyToClient(manager, { clientId: 100n, body: 'Отвечаю' });
    await aged(60);

    expect(await core.takeStaffAlerts(new Date())).toEqual([]);
  });

  it('не напоминает дважды об одном', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });
    await core.takeStaffAlerts(new Date());
    await aged(60);

    await core.takeStaffAlerts(new Date());

    expect(await core.takeStaffAlerts(new Date())).toEqual([]);
  });

  it('напоминает снова, если клиент написал после ответа и снова ждёт', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Первый' });
    await core.takeStaffAlerts(new Date());
    await aged(60);
    await core.takeStaffAlerts(new Date());

    await core.replyToClient(manager, { clientId: 100n, body: 'Отвечаю' });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Второй' });
    await core.takeStaffAlerts(new Date());
    await aged(60);

    expect(await core.takeStaffAlerts(new Date())).toEqual([
      expect.objectContaining({ kind: 'staff-waiting-client' }),
    ]);
  });
});

describe('наложившиеся вызовы', () => {
  it('не напоминают об одном дважды', async () => {
    /*
     * Зовут эту операцию двое: планировщик по расписанию и клиентский
     * деплой сразу после события. Наложившись, они прочитали бы ленту
     * каждый в своём снимке — и менеджер получил бы два одинаковых
     * напоминания об одном клиенте.
     */
    await givenExchangeRequest();
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });
    await core.takeStaffAlerts(new Date());
    await aged(60);

    const at = new Date();
    const [first, second] = await Promise.all([
      core.takeStaffAlerts(at),
      core.takeStaffAlerts(at),
    ]);

    expect([...first!, ...second!]).toHaveLength(2);
  });
});

describe('тишина', () => {
  it('не напоминает, когда всё разобрано', async () => {
    await aged(60);

    expect(await core.takeStaffAlerts(new Date())).toEqual([]);
  });
});
