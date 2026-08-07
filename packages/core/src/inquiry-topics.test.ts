import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import { givenStaff } from './test-support.js';

/**
 * Тема обращения живёт в данных, а не в тексте.
 *
 * Просьба оплатить отель уходила обычным сообщением, и тема была склеена
 * с текстом: «Оплата отеля. Hilton, Бангкок…». В очереди обращений видно
 * последнее сообщение, и просьба про деньги терялась среди «а какой
 * курс». Разбирать префикс нельзя — это правда, живущая в
 * форматировании, и она рассыпается от первой правки формулировки.
 *
 * Проверяется поэтому именно отбор: менеджер спрашивает «где просьбы об
 * оплате», и ответить на это должна выборка.
 */

const core = createCore({ db: testDatabase() });

let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  await core.registerClient({ telegramUserId: 100n, username: 'sprosil' });
  await core.registerClient({ telegramUserId: 200n, username: 'otel' });
  await core.registerClient({ telegramUserId: 300n, username: 'pokupka' });
  manager = await givenStaff({ displayName: 'Пётр' });
});

afterAll(() => closeTestDatabase());

describe('тема обращения', () => {
  it('у просьбы об оплате записана, а не склеена с текстом', async () => {
    const { message } = await core.submitInquiry({
      telegramUserId: 200n,
      topic: 'hotel',
      details: 'Hilton, Бангкок, 12–15 марта',
    });

    expect(message.topic).toBe('hotel');
  });

  /*
   * Обычный вопрос темы не имеет: тему называет тот, кто пришёл из
   * раздела «За границей», а спросивший курс ничего не выбирал.
   * «Поддержка» — это её отсутствие, а не ещё одно значение: иначе
   * пришлось бы проставлять её каждому сообщению, включая пришедшие до
   * того, как темы появились.
   */
  it('у обычного вопроса пуста', async () => {
    const { message } = await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'А какой курс?',
    });

    expect(message.topic).toBeNull();
  });
});

describe('отбор разговоров по теме', () => {
  /** Разговор, начатый просьбой об оплате. */
  async function givenInquiry(clientId: bigint, topic: 'hotel' | 'purchase'): Promise<void> {
    await core.submitInquiry({ telegramUserId: clientId, topic, details: 'что оплатить' });
  }

  it('разговор помечен темой последней просьбы', async () => {
    // Две просьбы подряд: клиент передумал и попросил про другое.
    // Разговор про то, о чём он попросил последним.
    await givenInquiry(200n, 'hotel');
    await givenInquiry(200n, 'purchase');

    const [conversation] = await core.listConversations(manager);

    expect(conversation?.topic).toBe('purchase');
  });

  /*
   * Клиент попросил оплатить отель, а следом дописал «и ещё вопрос».
   * Разговор от этого не перестал быть про оплату: тема — свойство
   * просьбы, а не последнего сообщения в ленте.
   */
  it('дописанный вопрос темы разговора не сбрасывает', async () => {
    await givenInquiry(200n, 'hotel');
    await core.receiveClientMessage({ telegramUserId: 200n, body: 'и ещё вопрос' });

    const [conversation] = await core.listConversations(manager);

    expect(conversation?.topic).toBe('hotel');
  });

  it('у разговора без просьб темы нет', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'А какой курс?' });

    const [conversation] = await core.listConversations(manager);

    expect(conversation?.topic).toBeNull();
  });

  /*
   * Менеджер спрашивает «где просьбы про деньги», а не «где отель».
   * Отель и покупка — обе про оплату продукта, и в отборе идут вместе;
   * какая именно, видно в самой строке.
   */
  it('отбирает просьбы об оплате — и отель, и покупку', async () => {
    await givenInquiry(200n, 'hotel');
    await givenInquiry(300n, 'purchase');
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'А какой курс?' });

    const found = await core.listConversations(manager, { topic: 'payment' });

    expect(found.map((one) => one.clientId).sort()).toEqual([200n, 300n].sort());
  });

  it('отбирает поддержку — всё, что не просьба об оплате', async () => {
    await givenInquiry(200n, 'hotel');
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'А какой курс?' });

    const found = await core.listConversations(manager, { topic: 'support' });

    expect(found.map((one) => one.clientId)).toEqual([100n]);
  });

  it('без отбора отдаёт всех', async () => {
    await givenInquiry(200n, 'hotel');
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'А какой курс?' });

    expect(await core.listConversations(manager)).toHaveLength(2);
  });
});
