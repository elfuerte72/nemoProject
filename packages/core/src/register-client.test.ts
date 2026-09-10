import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { referrals } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, NotFoundError } from './index.js';
import { asClient, givenReferralLines, givenStaff } from './test-support.js';

/**
 * Регистрация клиента и реферальная привязка.
 *
 * Привязка определяет, кому уйдут деньги с каждого будущего обмена, и
 * поменять её задним числом нельзя. Поэтому правила здесь проверяются
 * не на «работает ли создание строки», а на том, что привязка возникает
 * ровно один раз и ровно у того, кто пригласил.
 */

const db = testDatabase();
const core = createCore({ db });

beforeEach(() => resetDatabase());
afterAll(() => closeTestDatabase());

describe('первый запуск приложения', () => {
  it('делает человека клиентом без отдельной регистрации', async () => {
    const { client, created } = await core.registerClient({
      telegramUserId: 100n,
      username: 'ivan',
    });

    expect(created).toBe(true);
    expect(client.telegramUserId).toBe(100n);
    expect(client.referralCode).toMatch(/^\S+$/);
  });

  it('повторный запуск не создаёт второго клиента', async () => {
    const first = await core.registerClient({ telegramUserId: 100n });
    const second = await core.registerClient({ telegramUserId: 100n });

    expect(second.created).toBe(false);
    expect(second.client.referralCode).toBe(first.client.referralCode);
  });

  it('обновляет username, который клиент сменил в Telegram', async () => {
    await core.registerClient({ telegramUserId: 100n, username: 'ivan' });
    const { client } = await core.registerClient({
      telegramUserId: 100n,
      username: 'ivan_new',
    });

    expect(client.username).toBe('ivan_new');
  });
});

describe('реферальная привязка', () => {
  it('закрепляет пришедшего по ссылке за пригласившим', async () => {
    const referrer = await core.registerClient({ telegramUserId: 100n });

    const { client } = await core.registerClient({
      telegramUserId: 200n,
      referralCode: referrer.client.referralCode,
    });

    expect(client.referrerId).toBe(100n);
  });

  it('создаёт вторую линию, когда у пригласившего есть свой реферер', async () => {
    const top = await core.registerClient({ telegramUserId: 100n });
    const middle = await core.registerClient({
      telegramUserId: 200n,
      referralCode: top.client.referralCode,
    });

    const bottom = await core.registerClient({
      telegramUserId: 300n,
      referralCode: middle.client.referralCode,
    });

    expect(bottom.notifications).toContainEqual(
      expect.objectContaining({ kind: 'referral-joined', to: 200n, line: 1 }),
    );
    expect(bottom.notifications).toContainEqual(
      expect.objectContaining({ kind: 'referral-joined', to: 100n, line: 2 }),
    );
  });

  it('привязывает всю цепочку предков — до пятой линии, не глубже', async () => {
    // Цепочка хранится глубже, чем платится (docs/adr/0021): сколько
    // линий оплачивается, решает программа при начислении.
    let code = (await core.registerClient({ telegramUserId: 100n })).client.referralCode;
    for (const id of [200n, 300n, 400n, 500n, 600n]) {
      code = (await core.registerClient({ telegramUserId: id, referralCode: code })).client
        .referralCode;
    }

    await core.registerClient({ telegramUserId: 700n, referralCode: code });

    const rows = await db
      .select({ referrerId: referrals.referrerId, line: referrals.line })
      .from(referrals)
      .where(eq(referrals.referralId, 700n))
      .orderBy(asc(referrals.line));

    expect(rows.map((row) => [row.referrerId, row.line])).toEqual([
      [600n, 1],
      [500n, 2],
      [400n, 3],
      [300n, 4],
      [200n, 5],
    ]);
  });

  it('сообщает только тем, кому за эту линию платят', async () => {
    /*
     * Строка цепочки пишется до пятой линии всегда, а уведомление
     * уходит по глубине программы: «У вас новый реферал пятой линии»
     * тому, кому за неё не начислят ни балла, — это обещание, которого
     * сервис не давал. По той же причине справка помощника не называет
     * неоплачиваемые линии.
     */
    await givenReferralLines([500, 200]);
    let code = (await core.registerClient({ telegramUserId: 100n })).client.referralCode;
    for (const id of [200n, 300n, 400n]) {
      code = (await core.registerClient({ telegramUserId: id, referralCode: code })).client
        .referralCode;
    }

    const fifth = await core.registerClient({ telegramUserId: 500n, referralCode: code });

    expect(
      fifth.notifications.map((notification) =>
        notification.kind === 'referral-joined'
          ? [notification.to, notification.line]
          : notification.kind,
      ),
    ).toEqual([
      [400n, 1],
      [300n, 2],
    ]);
  });

  it('не меняет реферера при повторном запуске по чужой ссылке', async () => {
    const first = await core.registerClient({ telegramUserId: 100n });
    const other = await core.registerClient({ telegramUserId: 200n });
    await core.registerClient({ telegramUserId: 300n, referralCode: first.client.referralCode });

    const { client } = await core.registerClient({
      telegramUserId: 300n,
      referralCode: other.client.referralCode,
    });

    expect(client.referrerId).toBe(100n);
  });

  it('не делает клиента его собственным реферером', async () => {
    const { client } = await core.registerClient({ telegramUserId: 100n });

    const repeated = await core.registerClient({
      telegramUserId: 100n,
      referralCode: client.referralCode,
    });

    expect(repeated.client.referrerId).toBeNull();
  });

  it('оставляет клиента без реферера, когда код из ссылки неизвестен', async () => {
    const { client, notifications } = await core.registerClient({
      telegramUserId: 100n,
      referralCode: 'ЭТОГО-КОДА-НЕТ',
    });

    expect(client.referrerId).toBeNull();
    expect(notifications).toEqual([]);
  });
});

describe('уведомления о реферале', () => {
  it('сообщают пригласившему о регистрации его реферала', async () => {
    const referrer = await core.registerClient({ telegramUserId: 100n });

    const { notifications } = await core.registerClient({
      telegramUserId: 200n,
      referralCode: referrer.client.referralCode,
    });

    expect(notifications).toEqual([
      expect.objectContaining({ kind: 'referral-joined', to: 100n, line: 1 }),
    ]);
  });

  it('не сообщают ничего, когда клиент пришёл сам по себе', async () => {
    const { notifications } = await core.registerClient({ telegramUserId: 100n });

    expect(notifications).toEqual([]);
  });
});

describe('карточка клиента для сотрудника', () => {
  it('называет ник и того, кто привёл: с кем идёт разговор', async () => {
    const manager = await givenStaff({ displayName: 'Пётр' });
    const referrer = await core.registerClient({
      telegramUserId: 100n,
      username: 'ivan_p',
    });
    await core.registerClient({
      telegramUserId: 200n,
      username: 'maria_k',
      referralCode: referrer.client.referralCode,
    });

    const card = await core.getClientCard(manager, 200n);

    expect(card).toMatchObject({
      telegramUserId: 200n,
      username: 'maria_k',
      referrerId: 100n,
      referrerUsername: 'ivan_p',
    });
  });

  it('не даётся клиенту: чужой профиль читает только сотрудник', async () => {
    await core.registerClient({ telegramUserId: 100n });
    await core.registerClient({ telegramUserId: 200n });

    await expect(core.getClientCard(asClient(200n), 100n)).rejects.toThrow(ForbiddenError);
  });

  it('отказывает по незнакомому номеру, а не выдумывает пустую карточку', async () => {
    const manager = await givenStaff({ displayName: 'Пётр' });

    await expect(core.getClientCard(manager, 999n)).rejects.toThrow(NotFoundError);
  });
});
