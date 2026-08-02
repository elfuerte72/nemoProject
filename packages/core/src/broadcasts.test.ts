import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, InvalidInputError, type Actor } from './index.js';
import { asClient, givenStaff } from './test-support.js';

/**
 * Согласие на рассылку и ручные рассылки.
 *
 * Проверяется главное: сообщения не уходят тем, кто не соглашался или
 * отписался. Отписка, действующая «со следующей рассылки», — это ещё
 * одно письмо человеку, который попросил их прекратить.
 */

const core = createCore({ db: testDatabase() });

let admin: Actor & { type: 'staff' };
let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  admin = await givenStaff({ role: 'admin' });
  manager = await givenStaff({ role: 'manager' });
});

afterAll(() => closeTestDatabase());

describe('согласие клиента', () => {
  it('при первом входе не выдано: клиент о нём ещё не спрошен', async () => {
    const { client, created } = await core.registerClient({ telegramUserId: 100n });

    expect({ created, consent: client.marketingConsent }).toEqual({
      created: true,
      consent: false,
    });
  });

  it('даётся ответом клиента', async () => {
    await core.registerClient({ telegramUserId: 100n });

    expect(await core.setMarketingConsent(asClient(100n), true)).toEqual({
      marketingConsent: true,
      asked: true,
    });
  });

  it('спрашивается снова, пока клиент не ответил', async () => {
    const first = await core.registerClient({ telegramUserId: 100n });
    expect(first.client.marketingConsentAsked).toBe(false);

    // Закрыл приложение, не ответив, и открыл заново: вопрос остаётся.
    const second = await core.registerClient({ telegramUserId: 100n });
    expect(second.client.marketingConsentAsked).toBe(false);

    await core.setMarketingConsent(asClient(100n), false);

    const third = await core.registerClient({ telegramUserId: 100n });
    expect(third.client.marketingConsentAsked).toBe(true);
  });

  it('снимается немедленно', async () => {
    await core.registerClient({ telegramUserId: 100n });
    await core.setMarketingConsent(asClient(100n), true);

    await core.setMarketingConsent(asClient(100n), false);

    const { recipients } = await core.startBroadcast(admin, { body: 'Новые направления' });
    expect(recipients).toEqual([]);
  });

  it('переживает повторный запуск приложения', async () => {
    await core.registerClient({ telegramUserId: 100n });
    await core.setMarketingConsent(asClient(100n), true);

    const { client } = await core.registerClient({ telegramUserId: 100n });

    expect(client.marketingConsent).toBe(true);
  });
});

describe('рассылка', () => {
  it('уходит только согласившимся', async () => {
    await core.registerClient({ telegramUserId: 100n });
    await core.registerClient({ telegramUserId: 200n });
    await core.registerClient({ telegramUserId: 300n });
    await core.setMarketingConsent(asClient(100n), true);
    await core.setMarketingConsent(asClient(300n), true);

    const { broadcast, recipients } = await core.startBroadcast(admin, {
      body: 'Новые направления обмена',
    });

    expect([...recipients].sort()).toEqual([100n, 300n]);
    expect(broadcast.recipients).toBe(2);
  });

  it('не составляется без текста', async () => {
    await expect(core.startBroadcast(admin, { body: '   ' })).rejects.toThrow(
      InvalidInputError,
    );
  });

  it('менеджеру не доступна', async () => {
    await expect(core.startBroadcast(manager, { body: 'Привет' })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(core.listBroadcasts(manager)).rejects.toThrow(ForbiddenError);
  });

  it('сохраняет результат отправки', async () => {
    await core.registerClient({ telegramUserId: 100n });
    await core.setMarketingConsent(asClient(100n), true);
    const { broadcast } = await core.startBroadcast(admin, { body: 'Новые направления' });

    // Заблокировавшие бота попадают в недоставленные, а не роняют
    // рассылку остальным.
    const finished = await core.finishBroadcast(admin, broadcast.id, {
      delivered: 1,
      failed: 0,
    });

    expect(finished).toMatchObject({ delivered: 1, failed: 0 });
    expect(finished.finishedAt).toBeInstanceOf(Date);
  });

  it('видна администратору списком с результатами', async () => {
    await core.registerClient({ telegramUserId: 100n });
    await core.setMarketingConsent(asClient(100n), true);
    const { broadcast } = await core.startBroadcast(admin, { body: 'Новые направления' });
    await core.finishBroadcast(admin, broadcast.id, { delivered: 0, failed: 1 });

    expect(await core.listBroadcasts(admin)).toEqual([
      expect.objectContaining({
        body: 'Новые направления',
        recipients: 1,
        delivered: 0,
        failed: 1,
      }),
    ]);
  });
});
