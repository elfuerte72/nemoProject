import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, InvalidInputError } from './index.js';
import { givenStaff } from './test-support.js';

/**
 * Просьба оплатить за границей.
 *
 * Своей сущности у неё нет: она уходит обращением в переписку, и
 * проверяется здесь именно это — что менеджер видит просьбу там же, где
 * остальные вопросы клиента, и что она подписана темой. Подпись важна:
 * менеджер читает ленту подряд, и без неё «Hilton, Бангкок» ничем не
 * отличается от обычного сообщения.
 */

const core = createCore({ db: testDatabase() });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(() => closeTestDatabase());

describe('просьба оплатить за границей', () => {
  it('ложится в переписку подписанной темой', async () => {
    const staff = await givenStaff();
    await core.submitInquiry({
      telegramUserId: 100n,
      topic: 'hotel',
      details: 'Hilton, Бангкок, 12–15 марта, 18 400 THB',
    });

    const messages = await core.listConversation(staff, 100n);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      direction: 'incoming',
      body: 'Оплата отеля. Hilton, Бангкок, 12–15 марта, 18 400 THB',
    });
  });

  it('заводит клиента, который приложение только что открыл', async () => {
    // Просьба может оказаться первым, что человек делает в сервисе, —
    // ровно как и первое сообщение боту.
    const staff = await givenStaff();
    await core.submitInquiry({
      telegramUserId: 200n,
      topic: 'purchase',
      details: 'Amazon, ссылка на товар, 240 USD',
    });

    expect(await core.listConversation(staff, 200n)).toHaveLength(1);
  });

  it('отвергает тему, которой сервис не знает', async () => {
    await expect(
      core.submitInquiry({ telegramUserId: 100n, topic: 'яхта', details: 'что-нибудь' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает пустое описание', async () => {
    await expect(
      core.submitInquiry({ telegramUserId: 100n, topic: 'hotel', details: '   ' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает описание длиннее тысячи знаков', async () => {
    await expect(
      core.submitInquiry({
        telegramUserId: 100n,
        topic: 'hotel',
        details: 'а'.repeat(1001),
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});
