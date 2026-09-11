import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { exchangeRequests, webhookDeliveries } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenMerchant,
  givenNetwork,
  givenStaff,
  testRequisiteKeys,
} from './test-support.js';

/**
 * Сводка мерчанта — по правилам аналитики (docs/adr/0013): заявки по
 * дате подачи, деньги по дате исполнения, сравнение с равным периодом
 * прямо перед выбранным, валюты не складываются. Своё у мерчанта —
 * вызовы API и доставки вебхуков за период, и то, что чужие заявки —
 * клиента, другого мерчанта — в его числа не попадают.
 */

const db = testDatabase();
const core = createCore({
  db,
  requisites: { publicKey: testRequisiteKeys.publicKey, privateKey: testRequisiteKeys.privateKey },
  apiKeyPrefix: 'sk_test_',
});

let manager: Actor & { type: 'staff' };
let merchant: Actor & { type: 'merchant' };

const DAY = 24 * 60 * 60 * 1000;
/** Момент `daysAgo` дней назад в `hour` часов UTC. */
const at = (daysAgo: number, hour = 12) => {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  return new Date(date.getTime() - daysAgo * DAY);
};

const CARD = { kind: 'card', bankName: 'Сбербанк', cardNumber: '4111111111111111' } as const;
const WALLET = { kind: 'wallet', network: 'TRC20', address: 'TN3W4H6rK2ce4vX9YnFQHwKENnHjJ8nZ3f' } as const;

/** Заявка операциями, а не строкой: сцена должна быть достижимой. */
async function givenRequest(input: {
  owner: Actor;
  fromCode: string;
  toCode: string;
  fromAmount: string;
  fate: 'completed' | 'cancelled' | 'open';
  submittedAt: Date;
  finishedAt?: Date;
}): Promise<string> {
  const payout = input.toCode === 'USDT' ? WALLET : CARD;
  const { request } = await core.submitExchangeRequest(input.owner, {
    kind: 'electronic',
    fromCode: input.fromCode,
    toCode: input.toCode,
    fromAmount: input.fromAmount,
    payout,
  });
  await core.claimExchangeRequest(manager, request.id);
  if (input.fate !== 'open') {
    await core.confirmExchangeRate(manager, request.id, {
      finalRate: '80',
      paymentInstructions: 'Кошелёк TRC20',
    });
    if (input.fate === 'completed') {
      await core.markPaymentReceived(manager, request.id);
      await core.completeExchangeRequest(manager, request.id, {
        serviceIncome: '1',
        serviceIncomeCode: input.fromCode,
      });
    } else {
      await core.cancelExchangeRequest(manager, request.id, { reason: 'Не пришёл' });
    }
  }
  // Время — фикстурой: операции пишут «сейчас», а сцена — про даты.
  await db
    .update(exchangeRequests)
    .set({
      createdAt: input.submittedAt,
      updatedAt: input.finishedAt ?? input.submittedAt,
      ...(input.fate === 'completed' ? { completedAt: input.finishedAt ?? input.submittedAt } : {}),
    })
    .where(eq(exchangeRequests.id, request.id));
  return request.id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' });
  await givenNetwork('TRC20');
  await core.registerClient({ telegramUserId: 100n, username: 'elfuerte' });
  manager = await givenStaff({ displayName: 'Пётр' });
  merchant = await givenMerchant({ email: 'shop@example.com' });
});

afterAll(() => closeTestDatabase());

describe('сводка мерчанта за период', () => {
  it('считает заявки по подаче, деньги по исполнению и валюты раздельно', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(5),
      finishedAt: at(5, 13),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '50000',
      fate: 'completed',
      submittedAt: at(3),
      finishedAt: at(2),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '70',
      fate: 'cancelled',
      submittedAt: at(2),
      finishedAt: at(2, 15),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '90',
      fate: 'open',
      submittedAt: at(1),
    });
    // Прошлый период: одна исполненная — с ней и сравнивают.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '300',
      fate: 'completed',
      submittedAt: at(10),
      finishedAt: at(10, 14),
    });

    const stats = await core.summarizeMerchant(merchant, merchant.merchantId, period);

    expect(stats.current).toMatchObject({ submitted: 4, completed: 2, cancelled: 1, open: 1 });
    // Рубли с рублями, USDT с USDT — одного числа «оборот» нет.
    expect(stats.current.turnover).toEqual([
      { code: 'RUB', amount: '50000', count: 1 },
      { code: 'USDT', amount: '100', count: 1 },
    ]);
    // Первая исполнена за час, вторая за сутки: в среднем 12,5 часа.
    expect(stats.current.averageMinutesToComplete).toBeCloseTo(750, 0);
    expect(stats.previous).toMatchObject({ submitted: 1, completed: 1, cancelled: 0, open: 0 });
    expect(stats.previous.turnover).toEqual([{ code: 'USDT', amount: '300', count: 1 }]);
  });

  it('считает конверсию среди поданных в период, а не отношение двух чисел', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    // Подана в период и исполнена — в конверсию идёт.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(5),
      finishedAt: at(5, 13),
    });
    // Подана в период, но не дошла.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '90',
      fate: 'open',
      submittedAt: at(4),
    });
    /*
     * Подана до периода, исполнена внутри: в «исполнено» она попадает,
     * а в конверсию — нет. Делить одно на другое значило бы считать
     * конверсию больше единицы в ту неделю, когда разгребли хвост.
     */
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '300',
      fate: 'completed',
      submittedAt: at(9),
      finishedAt: at(3),
    });

    const stats = await core.summarizeMerchant(merchant, merchant.merchantId, period);

    expect(stats.current).toMatchObject({ submitted: 2, completed: 2 });
    expect(stats.current.conversion).toBeCloseTo(0.5, 5);
  });

  it('без поданных конверсии нет, а не ноль', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    const stats = await core.summarizeMerchant(merchant, merchant.merchantId, period);
    expect(stats.current.conversion).toBeNull();
  });

  it('чужие заявки в числа мерчанта не попадают', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    const other = await givenMerchant({ email: 'other@example.com' });
    await givenRequest({
      owner: asClient(100n),
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(4),
    });
    await givenRequest({
      owner: other,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(4),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '50',
      fate: 'open',
      submittedAt: at(1),
    });

    const stats = await core.summarizeMerchant(manager, merchant.merchantId, period);

    expect(stats.current).toMatchObject({ submitted: 1, completed: 0, cancelled: 0, open: 1 });
    expect(stats.current.turnover).toEqual([]);
  });

  it('считает вызовы API с долей отказов и доставки вебхуков', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    const key = await core.issueApiKey(merchant, { label: 'Сайт' });
    const call = (status: number, when: Date) =>
      core.logApiRequest({
        merchantId: merchant.merchantId,
        apiKeyId: key.key.id,
        method: 'GET',
        path: '/api/v1/rates',
        status,
        durationMs: 10,
        at: when,
      });
    await call(200, at(3));
    await call(200, at(2));
    await call(422, at(1));
    // Вне периода — не считается.
    await call(500, at(20));

    await core.addWebhookEndpoint(merchant, {
      url: 'https://shop.example/hooks',
      events: ['exchange_request.created'],
    });
    await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: CARD,
    });
    // Доставка заведена «сейчас» — в границы периода её ставит фикстура.
    await db.update(webhookDeliveries).set({ createdAt: at(1), status: 'failed' });

    const stats = await core.summarizeMerchant(merchant, merchant.merchantId, period);

    expect(stats.current.apiCalls).toEqual({ total: 3, failed: 1 });
    expect(stats.current.webhookDeliveries).toEqual({ total: 1, failed: 1 });
    expect(stats.previous.apiCalls).toEqual({ total: 0, failed: 0 });
  });

  it('раскладывает подано и исполнено по дням за две недели, с нулями', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(3),
      finishedAt: at(2),
    });

    const now = at(0, 15);
    const stats = await core.summarizeMerchant(merchant, merchant.merchantId, period, {
      offsetMinutes: 0,
      now,
    });

    expect(stats.byDay).toHaveLength(14);
    expect(stats.byDay[13]?.day).toBe(now.toISOString().slice(0, 10));
    const submittedDay = at(3).toISOString().slice(0, 10);
    const completedDay = at(2).toISOString().slice(0, 10);
    expect(stats.byDay.find((one) => one.day === submittedDay)).toEqual({
      day: submittedDay,
      submitted: 1,
      completed: 0,
    });
    expect(stats.byDay.find((one) => one.day === completedDay)).toEqual({
      day: completedDay,
      submitted: 0,
      completed: 1,
    });
    expect(stats.byDay.filter((one) => one.submitted + one.completed === 0)).toHaveLength(12);
    // «Сегодня» — из того же ответа: строке над плитками второй заход не нужен.
    expect(stats.today).toEqual({ submitted: 0, completed: 0, cancelled: 0 });
  });

  it('границы дня — по часам того, кто смотрит', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    // Подана в 22:00 UTC вчера — в Бангкоке (UTC+7) это уже 05:00 сегодня.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'open',
      submittedAt: at(1, 22),
    });
    const now = at(0, 6);

    const bangkok = await core.summarizeMerchant(merchant, merchant.merchantId, period, {
      offsetMinutes: 7 * 60,
      now,
    });
    const utc = await core.summarizeMerchant(merchant, merchant.merchantId, period, {
      offsetMinutes: 0,
      now,
    });

    expect(bangkok.today.submitted).toBe(1);
    expect(bangkok.byDay[13]?.submitted).toBe(1);
    expect(utc.today.submitted).toBe(0);
    expect(utc.byDay[12]?.submitted).toBe(1);
  });

  it('мерчант видит только свою сводку, сотрудник — любую, клиент — никакую', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    const other = await givenMerchant({ email: 'other@example.com' });

    await expect(core.summarizeMerchant(merchant, other.merchantId, period)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(core.summarizeMerchant(manager, other.merchantId, period)).resolves.toBeDefined();
    await expect(core.summarizeMerchant(asClient(100n), merchant.merchantId, period)).rejects.toMatchObject(
      { code: 'forbidden' },
    );
  });
});

describe('активность мерчантов для списка', () => {
  it('исполнено с даты и оборот по валютам — по каждому мерчанту', async () => {
    const other = await givenMerchant({ email: 'other@example.com' });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(5),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '1000',
      fate: 'completed',
      submittedAt: at(4),
    });
    // Давнее и незаконченное — не активность за срок.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '999',
      fate: 'completed',
      submittedAt: at(40),
    });
    await givenRequest({
      owner: other,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '50',
      fate: 'open',
      submittedAt: at(1),
    });

    const activity = await core.merchantActivitySince(manager, at(30, 0));

    expect(activity.get(merchant.merchantId)).toEqual({
      completed: 2,
      turnover: [
        { code: 'RUB', amount: '1000', count: 1 },
        { code: 'USDT', amount: '100', count: 1 },
      ],
    });
    expect(activity.get(other.merchantId)).toBeUndefined();
    await expect(core.merchantActivitySince(merchant, at(30, 0))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
