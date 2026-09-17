import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  ConflictError,
  createCore,
  ForbiddenError,
  InvalidInputError,
  type Actor,
} from './index.js';
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

    const { recipients } = await core.startBroadcast(admin, { body: 'Новые направления', idempotencyKey: 'черновик-1' });
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
      idempotencyKey: 'черновик',
    });

    expect([...recipients].sort()).toEqual([100n, 300n]);
    expect(broadcast.recipients).toBe(2);
  });

  it('не составляется без текста', async () => {
    await expect(core.startBroadcast(admin, { body: '   ', idempotencyKey: 'черновик-2' })).rejects.toThrow(
      InvalidInputError,
    );
  });

  it('менеджеру не доступна', async () => {
    await expect(core.startBroadcast(manager, { body: 'Привет', idempotencyKey: 'черновик-3' })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(core.listBroadcasts(manager)).rejects.toThrow(ForbiddenError);
  });

  it('сохраняет результат отправки', async () => {
    await core.registerClient({ telegramUserId: 100n });
    await core.setMarketingConsent(asClient(100n), true);
    const { broadcast } = await core.startBroadcast(admin, { body: 'Новые направления', idempotencyKey: 'черновик-4' });

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
    const { broadcast } = await core.startBroadcast(admin, { body: 'Новые направления', idempotencyKey: 'черновик-5' });
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

describe('повтор рассылки', () => {
  /*
   * Рассылка идёт минутами, а запрос, который её запустил, рвётся по
   * таймауту раньше. До 17 сентября 2026 форма говорила «повторите», и
   * повтор рассылал тот же текст всем согласившимся второй раз. Ключ
   * повтора выдаёт форма на черновик, а решает по нему операция.
   */
  async function givenConsenting(...ids: bigint[]): Promise<void> {
    for (const id of ids) {
      await core.registerClient({ telegramUserId: id });
      await core.setMarketingConsent(asClient(id), true);
    }
  }

  it('с тем же ключом не рассылает второй раз и отдаёт первую рассылку', async () => {
    await givenConsenting(100n, 200n);
    const first = await core.startBroadcast(admin, { body: 'Новые направления', idempotencyKey: 'k1' });

    const again = await core.startBroadcast(admin, { body: 'Новые направления', idempotencyKey: 'k1' });

    expect(first.repeated).toBe(false);
    expect(first.recipients).toHaveLength(2);
    expect(again).toMatchObject({ repeated: true, recipients: [] });
    expect(again.broadcast.id).toBe(first.broadcast.id);
    expect(await core.listBroadcasts(admin)).toHaveLength(1);
  });

  it('поданная дважды разом, заводится одна', async () => {
    await givenConsenting(100n);

    const both = await Promise.all([
      core.startBroadcast(admin, { body: 'Новые направления', idempotencyKey: 'k1' }),
      core.startBroadcast(admin, { body: 'Новые направления', idempotencyKey: 'k1' }),
    ]);

    expect(both.filter((one) => one.recipients.length > 0)).toHaveLength(1);
    expect(both.filter((one) => one.repeated)).toHaveLength(1);
    expect(await core.listBroadcasts(admin)).toHaveLength(1);
  });

  it('тот же текст с новым ключом — новая рассылка: её составили заново', async () => {
    await givenConsenting(100n);
    await core.startBroadcast(admin, { body: 'Скидка на выходных', idempotencyKey: 'k1' });

    const next = await core.startBroadcast(admin, { body: 'Скидка на выходных', idempotencyKey: 'k2' });

    expect(next).toMatchObject({ repeated: false, recipients: [100n] });
    expect(await core.listBroadcasts(admin)).toHaveLength(2);
  });

  it('тот же ключ с другим текстом отвергает, а не рассылает', async () => {
    await givenConsenting(100n);
    await core.startBroadcast(admin, { body: 'Скидка на выходных', idempotencyKey: 'k1' });

    await expect(
      core.startBroadcast(admin, { body: 'Скидка до понедельника', idempotencyKey: 'k1' }),
    ).rejects.toThrow(ConflictError);
    expect(await core.listBroadcasts(admin)).toHaveLength(1);
  });

  it('без ключа не составляется', async () => {
    await expect(
      core.startBroadcast(admin, { body: 'Новые направления', idempotencyKey: '  ' }),
    ).rejects.toThrow(InvalidInputError);
  });
});

describe('кому уйдёт рассылка', () => {
  it('администратору называет число согласившихся до отправки', async () => {
    await core.registerClient({ telegramUserId: 100n });
    await core.registerClient({ telegramUserId: 200n });
    await core.setMarketingConsent(asClient(100n), true);

    expect(await core.countBroadcastAudience(admin)).toBe(1);
    await expect(core.countBroadcastAudience(manager)).rejects.toThrow(ForbiddenError);
  });
});
