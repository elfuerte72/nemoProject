import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bonusTransactions, clients, exchangeRequests, referrals } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import { asClient, givenCurrencyPair, givenReferralLines, givenStaff } from './test-support.js';

/**
 * Реферальный кабинет клиента: сводка за период по правилам аналитики
 * (docs/adr/0013) и обезличенный список рефералов.
 *
 * Рефералы «пришли» по дате привязки (у пришедших по ссылке — дата
 * регистрации), «стали активными» по дате первой исполненной заявки, «начислено» по дате начисления,
 * «выплачено» по дате списания; сравнение с равным периодом прямо
 * перед выбранным; валюты оборота не складываются.
 */

const db = testDatabase();
const core = createCore({ db });
let manager: Actor & { type: 'staff' };

const DAY = 24 * 60 * 60 * 1000;
/** Момент `daysAgo` дней назад в `hour` часов UTC. */
const at = (daysAgo: number, hour = 12) => {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  return new Date(date.getTime() - daysAgo * DAY);
};

async function givenClient(telegramUserId: bigint, referralCode?: string, joinedAt?: Date): Promise<string> {
  const { client } = await core.registerClient({
    telegramUserId,
    username: `user${telegramUserId}`,
    ...(referralCode === undefined ? {} : { referralCode }),
  });
  if (joinedAt) {
    await db.update(clients).set({ createdAt: joinedAt }).where(eq(clients.telegramUserId, telegramUserId));
    await db.update(referrals).set({ createdAt: joinedAt }).where(eq(referrals.referralId, telegramUserId));
  }
  return client.referralCode;
}

/** Исполненная заявка реферала в момент `completedAt`; начисления датируются им же. */
async function givenCompleted(
  clientId: bigint,
  options: { fromCode?: string; toCode?: string; amount?: string; income?: string; completedAt: Date },
): Promise<string> {
  const { request } = await core.submitExchangeRequest(asClient(clientId), {
    kind: 'cash',
    fromCode: options.fromCode ?? 'USDT',
    toCode: options.toCode ?? 'RUB',
    fromAmount: options.amount ?? '1000',
  });
  await core.claimExchangeRequest(manager, request.id);
  await core.confirmExchangeRate(manager, request.id, { finalRate: '95', paymentInstructions: 'наличными' });
  await core.markPaymentReceived(manager, request.id);
  await core.completeExchangeRequest(manager, request.id, {
    serviceIncome: options.income ?? '1000',
    serviceIncomeCode: 'RUB',
  });
  await db
    .update(exchangeRequests)
    .set({ createdAt: options.completedAt, completedAt: options.completedAt, updatedAt: options.completedAt })
    .where(eq(exchangeRequests.id, request.id));
  await db
    .update(bonusTransactions)
    .set({ createdAt: options.completedAt })
    .where(eq(bonusTransactions.exchangeRequestId, request.id));
  return request.id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'cash' });
  manager = await givenStaff();
});
afterAll(() => closeTestDatabase());

describe('сводка кабинета за период', () => {
  it('считает пришедших, активных, начисленное и выплаченное — с прошлым периодом рядом', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    const me = await givenClient(1n);
    // В периоде пришли трое (двое первой линии, один второй), активными в
    // периоде стали двое: четвёртый пришёл до периода и первую заявку
    // исполнил тоже до него — он активен в прошлом периоде.
    const second = await givenClient(2n, me, at(5));
    await givenClient(3n, me, at(4));
    await givenClient(4n, me, at(10));
    await givenClient(5n, second, at(3)); // вторая линия, в периоде
    await givenCompleted(2n, { completedAt: at(4, 13) }); // 50 первой линии
    await givenCompleted(4n, { completedAt: at(2) }); // ещё 50
    await givenCompleted(4n, { completedAt: at(9) }); // до периода: 50 в прошлом
    await givenCompleted(5n, { completedAt: at(1) }); // вторая линия: 20 мне, 50 второму

    const stats = await core.summarizeReferralCabinet(asClient(1n), period, { offsetMinutes: 0 });

    expect(stats.current).toMatchObject({
      joined: 3,
      joinedByLine: [
        { line: 1, count: 2 },
        { line: 2, count: 1 },
      ],
      activated: 2,
      accrued: '120',
      accruals: 3,
      paid: '0',
    });
    expect(stats.previous).toMatchObject({ joined: 1, activated: 1, accrued: '50', accruals: 1 });
  });

  it('оборот приведённых — по валютам отданной стороны, без сложения', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    const me = await givenClient(1n);
    await givenClient(2n, me, at(6));
    await givenCompleted(2n, { amount: '100', completedAt: at(3) });
    await givenCompleted(2n, { amount: '150', completedAt: at(2) });
    await givenCompleted(2n, { fromCode: 'RUB', toCode: 'USDT', amount: '50000', completedAt: at(2, 15) });

    await givenCompleted(2n, { amount: '40', completedAt: at(9) }); // прошлый период

    const stats = await core.summarizeReferralCabinet(asClient(1n), period, { offsetMinutes: 0 });

    expect(stats.current.turnover).toEqual([
      { code: 'RUB', amount: '50000', count: 1 },
      { code: 'USDT', amount: '250', count: 2 },
    ]);
    expect(stats.previous.turnover).toEqual([{ code: 'USDT', amount: '40', count: 1 }]);
  });

  it('чужая сеть в числа не попадает, выплаченное — по дате списания', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    const me = await givenClient(1n);
    const other = await givenClient(9n);
    await givenClient(2n, me, at(5));
    await givenClient(8n, other, at(5));
    await givenCompleted(8n, { completedAt: at(3) });
    // Списание при выплате хранится отрицательным — сцена ставится
    // строкой: выплату исполняет менеджер, и здесь она не проверяется.
    await db.insert(bonusTransactions).values({
      clientId: 1n,
      kind: 'withdrawal',
      amount: '-30',
      createdAt: at(2),
    });

    const stats = await core.summarizeReferralCabinet(asClient(1n), period, { offsetMinutes: 0 });
    expect(stats.current).toMatchObject({ joined: 1, activated: 0, accrued: '0', paid: '30' });
    expect(stats.current.turnover).toEqual([]);
    expect((await core.listMyReferrals(asClient(1n), {})).total).toBe(1);
  });

  it('реферал глубже настроенной глубины в числа не попадает', async () => {
    await givenReferralLines([500, 200]);
    const period = { from: at(7, 0), to: at(0, 0) };
    const me = await givenClient(1n);
    const second = await givenClient(2n, me, at(6));
    const third = await givenClient(3n, second, at(5));
    await givenClient(4n, third, at(4)); // третья линия
    await givenCompleted(4n, { completedAt: at(2) });

    const stats = await core.summarizeReferralCabinet(asClient(1n), period, { offsetMinutes: 0 });

    expect(stats.current.joined).toBe(2);
    expect(stats.current.turnover).toEqual([]);
    expect(stats.current.accrued).toBe('0');
  });

  it('ждёт выплаты — открытые выводы сейчас, дни — по часам смотрящего', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    const me = await givenClient(1n);
    await givenClient(2n, me, at(1, 22));
    await givenCompleted(2n, { completedAt: at(1, 22) });

    const utc = await core.summarizeReferralCabinet(asClient(1n), period, { offsetMinutes: 0 });
    const bangkok = await core.summarizeReferralCabinet(asClient(1n), period, {
      offsetMinutes: 7 * 60,
    });

    expect(utc.byDay).toHaveLength(14);
    expect(utc.byDay.filter((day) => day.joined > 0).map((day) => day.joined)).toEqual([1]);
    // 22:00 UTC — это уже завтра по Бангкоку: столбик уезжает на день.
    const utcDay = utc.byDay.findIndex((day) => day.joined > 0);
    const bangkokDay = bangkok.byDay.findIndex((day) => day.joined > 0);
    expect(bangkokDay).toBe(utcDay + 1);
    expect(utc.byDay.find((day) => day.joined > 0)?.accrued).toBe('50');
    expect(utc.pending).toBe('0');
  });

  it('по кодам: кто по какому пришёл и сколько принёс первой линией', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    const me = await givenClient(1n);
    const promo = await core.createReferralCode(asClient(1n), { kind: 'promo', label: 'Лето', code: 'SUMMER26' });
    await givenClient(2n, me, at(5));
    await givenClient(3n, 'summer26', at(4));
    await givenCompleted(3n, { completedAt: at(2) });

    const stats = await core.summarizeReferralCabinet(asClient(1n), period, { offsetMinutes: 0 });

    expect(stats.codes).toEqual([
      expect.objectContaining({ label: 'Основная', joined: 1, accrued: '0' }),
      expect.objectContaining({ id: promo.id, label: 'Лето', joined: 1, accrued: '50' }),
    ]);
  });

  it('привязанный промокодом позже пришёл в день ввода кода — и по линиям, и по коду', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    await givenClient(1n);
    await core.createReferralCode(asClient(1n), { kind: 'promo', label: 'Лето', code: 'SUMMER26' });
    // Зарегистрировался давно, промокод ввёл вчера.
    await givenClient(2n, undefined, at(30));
    await core.bindReferrerByPromoCode(asClient(2n), 'summer26');
    await db.update(referrals).set({ createdAt: at(1) }).where(eq(referrals.referralId, 2n));

    const stats = await core.summarizeReferralCabinet(asClient(1n), period, { offsetMinutes: 0 });

    expect(stats.current.joined).toBe(1);
    expect(stats.codes.find((one) => one.label === 'Лето')?.joined).toBe(1);
    expect((await core.listMyReferrals(asClient(1n), {})).items[0]?.joinedAt).toEqual(at(1));
  });

  it('только клиенту и только период длиной до года', async () => {
    await givenClient(1n);
    await expect(
      core.summarizeReferralCabinet(manager, { from: at(7, 0), to: at(0, 0) }, {}),
    ).rejects.toThrow(/forbidden|клиент/i);
    await expect(
      core.summarizeReferralCabinet(asClient(1n), { from: at(400, 0), to: at(0, 0) }, {}),
    ).rejects.toThrow(/год/i);
  });
});

describe('список рефералов', () => {
  it('обезличен: ни имени, ни ника, ни идентификатора', async () => {
    const me = await givenClient(1n);
    await givenClient(2n, me, at(3));
    await givenCompleted(2n, { completedAt: at(2) });

    const page = await core.listMyReferrals(asClient(1n), {});

    expect(page.items).toEqual([
      expect.objectContaining({
        line: 1,
        via: expect.objectContaining({ label: 'Основная', kind: 'link' }),
        active: true,
        completedCount: 1,
        brought: '50',
      }),
    ]);
    const serialized = JSON.stringify(page, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
    expect(serialized).not.toContain('user2');
    expect(serialized).not.toMatch(/"2"|telegram/);
  });

  it('сужается по линии и листается смещением', async () => {
    const me = await givenClient(1n);
    const second = await givenClient(2n, me, at(6));
    await givenClient(3n, me, at(5));
    await givenClient(4n, second, at(4));

    const all = await core.listMyReferrals(asClient(1n), {});
    expect(all.total).toBe(3);
    expect(all.items.map((one) => one.line)).toEqual([2, 1, 1]);

    const first = await core.listMyReferrals(asClient(1n), { line: 1 });
    expect(first.items).toHaveLength(2);
    expect(first.items.every((one) => one.via !== null)).toBe(true);

    const page = await core.listMyReferrals(asClient(1n), { offset: 2, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextOffset).toBeNull();
    expect((await core.listMyReferrals(asClient(1n), { offset: 0, limit: 2 })).nextOffset).toBe(2);
  });

  it('на одинаковых датах страницы не теряют и не повторяют строки', async () => {
    const me = await givenClient(1n);
    const sameDay = at(3);
    for (const id of [2n, 3n, 4n, 5n]) {
      await givenClient(id, me, sameDay);
    }

    const seen: string[] = [];
    for (let offset: number | null = 0; offset !== null; ) {
      const page = await core.listMyReferrals(asClient(1n), { offset, limit: 3 });
      seen.push(...page.items.map((one) => `${one.joinedAt.toISOString()}:${one.brought}`));
      offset = page.nextOffset;
    }
    expect(seen).toHaveLength(4);
    // Строки различимы только порядком: дата у всех одна, и порядок
    // держится вторым ключом сортировки, а не случаем.
    const twice = await core.listMyReferrals(asClient(1n), { offset: 0, limit: 4 });
    expect(twice.items).toHaveLength(4);
    expect(twice.total).toBe(4);

    // Мусор в смещении — отказ словами, а не ошибка базы.
    await expect(core.listMyReferrals(asClient(1n), { offset: Number.NaN })).rejects.toThrow(
      /целое/,
    );
  });
});

describe('счёт с кодами и промокодом', () => {
  it('отдаёт действующие коды и говорит, можно ли ввести чужой промокод', async () => {
    const me = await givenClient(1n);
    await core.createReferralCode(asClient(1n), { kind: 'promo', label: 'Лето', code: 'SUMMER26' });
    await givenClient(2n, me);
    await givenClient(3n);

    expect((await core.getBonusAccount(asClient(1n))).codes.map((one) => one.code)).toEqual([
      me,
      'SUMMER26',
    ]);
    expect((await core.getBonusAccount(asClient(1n))).canEnterPromo).toBe(true);
    expect((await core.getBonusAccount(asClient(2n))).canEnterPromo).toBe(false);
    expect((await core.getBonusAccount(asClient(3n))).canEnterPromo).toBe(true);
    await givenCompleted(3n, { completedAt: at(1) });
    expect((await core.getBonusAccount(asClient(3n))).canEnterPromo).toBe(false);
  });
});
