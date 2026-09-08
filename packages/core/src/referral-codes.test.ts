import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { referralCodes } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { ConflictError, InvalidInputError } from './errors.js';
import { createCore } from './index.js';
import { asClient, givenCurrencyPair } from './test-support.js';

/**
 * Реферальные коды: несколько ссылок и промокодов у клиента, привязка по
 * промокоду после регистрации (docs/adr/0019).
 */

const db = testDatabase();
const core = createCore({ db });

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
});
afterAll(() => closeTestDatabase());

describe('коды клиента', () => {
  it('у нового клиента одна ссылка «Основная», и она же — его код', async () => {
    const { client } = await core.registerClient({ telegramUserId: 1n });

    const codes = await core.listReferralCodes(asClient(1n));
    expect(codes).toEqual([
      expect.objectContaining({ kind: 'link', label: 'Основная', code: client.referralCode }),
    ]);
  });

  it('ссылка заводится с названием, промокод — словом клиента', async () => {
    await core.registerClient({ telegramUserId: 1n });

    const link = await core.createReferralCode(asClient(1n), { kind: 'link', label: 'Сторис' });
    expect(link.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);

    const promo = await core.createReferralCode(asClient(1n), {
      kind: 'promo',
      label: 'Лето',
      code: ' summer26 ',
    });
    expect(promo.code).toBe('SUMMER26');
    expect((await core.listReferralCodes(asClient(1n))).map((one) => one.label)).toEqual([
      'Основная',
      'Сторис',
      'Лето',
    ]);
  });

  it('промокод проверяется словами и не повторяет чужой ни в каком регистре', async () => {
    await core.registerClient({ telegramUserId: 1n });
    await core.registerClient({ telegramUserId: 2n });
    await core.createReferralCode(asClient(1n), { kind: 'promo', label: 'Лето', code: 'SUMMER26' });

    await expect(
      core.createReferralCode(asClient(2n), { kind: 'promo', label: 'Лето', code: 'summer26' }),
    ).rejects.toThrow(ConflictError);
    await expect(
      core.createReferralCode(asClient(2n), { kind: 'promo', label: 'Лето', code: 'abc' }),
    ).rejects.toThrow(/от 4 знаков/);
    await expect(
      core.createReferralCode(asClient(2n), { kind: 'promo', label: 'Лето', code: 'tobee' }),
    ).rejects.toThrow(/занято сервисом/);
    await expect(
      core.createReferralCode(asClient(2n), { kind: 'promo', label: '', code: 'GOOD1' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('действующих кодов не больше десяти', async () => {
    await core.registerClient({ telegramUserId: 1n });
    for (let index = 0; index < 9; index += 1) {
      await core.createReferralCode(asClient(1n), { kind: 'link', label: `Ссылка ${index}` });
    }
    await expect(
      core.createReferralCode(asClient(1n), { kind: 'link', label: 'Одиннадцатая' }),
    ).rejects.toThrow(/десяти/);
  });

  it('архивируется свой и только не последняя ссылка', async () => {
    await core.registerClient({ telegramUserId: 1n });
    await core.registerClient({ telegramUserId: 2n });
    const [primary] = await core.listReferralCodes(asClient(1n));

    await expect(core.archiveReferralCode(asClient(1n), primary!.id)).rejects.toThrow(
      /последн/i,
    );
    const extra = await core.createReferralCode(asClient(1n), { kind: 'link', label: 'Канал' });
    await expect(core.archiveReferralCode(asClient(2n), extra.id)).rejects.toThrow(/не найден/i);
    await core.archiveReferralCode(asClient(1n), extra.id);
    expect((await core.listReferralCodes(asClient(1n))).map((one) => one.id)).toEqual([
      primary!.id,
    ]);
  });
});

describe('клиент без единой ссылки', () => {
  it('получает её при первом чтении: след выката, а не отказ', async () => {
    // Mini App старой сборки в окно выката заводил клиентов мимо
    // таблицы кодов; кабинет такому отвечает ссылкой, а не ошибкой.
    await core.registerClient({ telegramUserId: 1n });
    await db.delete(referralCodes).where(eq(referralCodes.clientId, 1n));

    const account = await core.getBonusAccount(asClient(1n));
    expect(account.referralCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);
    expect(await core.listReferralCodes(asClient(1n))).toEqual([
      expect.objectContaining({ kind: 'link', label: 'Основная', code: account.referralCode }),
    ]);
  });
});

describe('приход по коду', () => {
  it('по промокоду любого регистра, с отметкой, по какому коду пришёл', async () => {
    await core.registerClient({ telegramUserId: 1n });
    const promo = await core.createReferralCode(asClient(1n), {
      kind: 'promo',
      label: 'Лето',
      code: 'SUMMER26',
    });

    const { client, notifications } = await core.registerClient({
      telegramUserId: 2n,
      referralCode: 'summer26',
    });
    expect(client.referrerId).toBe(1n);
    expect(notifications).toEqual([{ kind: 'referral-joined', to: 1n, line: 1 }]);
    const card = await core.getClientCard(await givenAdmin(), 2n);
    expect(card.referredVia).toMatchObject({ id: promo.id, label: 'Лето' });
  });

  it('по архивному коду не привязывает', async () => {
    await core.registerClient({ telegramUserId: 1n });
    const extra = await core.createReferralCode(asClient(1n), { kind: 'link', label: 'Канал' });
    await core.archiveReferralCode(asClient(1n), extra.id);

    const { client } = await core.registerClient({ telegramUserId: 2n, referralCode: extra.code });
    expect(client.referrerId).toBeNull();
  });
});

describe('промокод после регистрации', () => {
  it('привязывает реферера тому, у кого ещё нет ни реферера, ни заявок', async () => {
    await core.registerClient({ telegramUserId: 1n });
    await core.createReferralCode(asClient(1n), { kind: 'promo', label: 'Лето', code: 'SUMMER26' });
    await core.registerClient({ telegramUserId: 2n });

    const { client, notifications } = await core.bindReferrerByPromoCode(asClient(2n), 'summer26');
    expect(client.referrerId).toBe(1n);
    expect(notifications).toEqual([{ kind: 'referral-joined', to: 1n, line: 1 }]);
    expect((await core.getBonusAccount(asClient(1n))).lines[0]?.count).toBe(1);
  });

  it('не замыкает цепочку в кольцо: код своего реферала не привязывает', async () => {
    const { client: first } = await core.registerClient({ telegramUserId: 1n });
    const { client: second } = await core.registerClient({
      telegramUserId: 2n,
      referralCode: first.referralCode,
    });

    await expect(core.bindReferrerByPromoCode(asClient(1n), second.referralCode)).rejects.toThrow(
      /вашему рефералу/i,
    );

    // И потомок глубже пятой линии — тоже: в `referrals` его нет, но по
    // `referrer_id` вверх он ведёт к первому.
    let code = second.referralCode;
    for (const id of [3n, 4n, 5n, 6n, 7n]) {
      code = (await core.registerClient({ telegramUserId: id, referralCode: code })).client
        .referralCode;
    }
    await expect(core.bindReferrerByPromoCode(asClient(1n), code)).rejects.toThrow(
      /вашему рефералу/i,
    );
  });

  it('отказывает словами: свой код, чужой неизвестный, уже есть реферер, уже есть заявка', async () => {
    const { client: first } = await core.registerClient({ telegramUserId: 1n });
    await core.registerClient({ telegramUserId: 2n });
    await core.registerClient({ telegramUserId: 3n, referralCode: first.referralCode });
    await core.registerClient({ telegramUserId: 4n });
    await core.submitExchangeRequest(asClient(4n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100000',
    });

    await expect(core.bindReferrerByPromoCode(asClient(1n), first.referralCode)).rejects.toThrow(
      /собственный/i,
    );
    await expect(core.bindReferrerByPromoCode(asClient(2n), 'NOSUCHCODE')).rejects.toThrow(
      /не найден/i,
    );
    await expect(core.bindReferrerByPromoCode(asClient(3n), first.referralCode)).rejects.toThrow(
      /уже пригласили/i,
    );
    await expect(core.bindReferrerByPromoCode(asClient(4n), first.referralCode)).rejects.toThrow(
      /заявк/i,
    );
  });
});

async function givenAdmin() {
  const { givenStaff } = await import('./test-support.js');
  return givenStaff({ role: 'admin' });
}
