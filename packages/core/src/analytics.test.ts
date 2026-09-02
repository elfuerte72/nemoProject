import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { exchangeRequests } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import { asClient, givenCurrencyPair, givenStaff, testRequisiteKeys } from './test-support.js';
import { previousPeriod } from './analytics.js';

/**
 * Сводка по заявкам за период.
 *
 * Правила, которых глазом не проверить: заявки считаются по дате
 * подачи, деньги — по дате исполнения; валюты не смешиваются; отменённая
 * не попадает в оборот; предыдущий период считается от границы, а не
 * от календаря.
 */

const db = testDatabase();
const core = createCore({
  db,
  requisites: {
    publicKey: testRequisiteKeys.publicKey,
    privateKey: testRequisiteKeys.privateKey,
  },
});

let admin: Actor & { type: 'staff' };
let manager: Actor & { type: 'staff' };

const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number, hour = 12) => {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  return new Date(date.getTime() - daysAgo * DAY);
};

/** Заявка операциями, а не строкой: сцена должна быть достижимой. */
async function givenRequest(input: {
  fromCode: string;
  toCode: string;
  fromAmount: string;
  fate: 'completed' | 'cancelled' | 'open';
  income?: { amount: string; code: string };
  submittedAt: Date;
  finishedAt?: Date;
}): Promise<string> {
  const { request } = await core.submitExchangeRequest(asClient(100n), {
    kind: 'cash',
    fromCode: input.fromCode,
    toCode: input.toCode,
    fromAmount: input.fromAmount,
  });
  await core.claimExchangeRequest(manager, request.id);
  if (input.fate !== 'open') {
    await core.confirmExchangeRate(manager, request.id, {
      finalRate: '80',
      toAmount: '1',
      paymentInstructions: 'У кассы',
    });
    if (input.fate === 'completed') {
      await core.markPaymentReceived(manager, request.id);
      await core.completeExchangeRequest(manager, request.id, {
        serviceIncome: input.income?.amount ?? '0',
        serviceIncomeCode: input.income?.code ?? input.fromCode,
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
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'cash' });
  await core.registerClient({ telegramUserId: 100n, username: 'elfuerte' });
  admin = await givenStaff({ displayName: 'Мария', role: 'admin' });
  manager = await givenStaff({ displayName: 'Пётр' });
});

afterAll(() => closeTestDatabase());

describe('сводка за период', () => {
  it('деньги по валютам раздельно, отменённая не в обороте, конверсия по поданным', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    await givenRequest({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      income: { amount: '160', code: 'RUB' },
      submittedAt: at(5),
      finishedAt: at(5, 13),
    });
    await givenRequest({
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '50000',
      fate: 'completed',
      income: { amount: '12.5', code: 'USDT' },
      submittedAt: at(4),
      finishedAt: at(3),
    });
    await givenRequest({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '999',
      fate: 'cancelled',
      submittedAt: at(2),
    });

    const { current } = await core.summarizeExchangeRequests(admin, period);

    expect(current.submitted).toBe(3);
    expect(current.completed).toBe(2);
    expect(current.cancelled).toBe(1);
    expect(current.open).toBe(0);
    expect(current.turnover).toEqual([
      { code: 'RUB', amount: '50000', count: 1 },
      { code: 'USDT', amount: '100', count: 1 },
    ]);
    expect(current.income).toEqual([
      { code: 'RUB', amount: '160', count: 1 },
      { code: 'USDT', amount: '12.5', count: 1 },
    ]);
    expect(current.conversion).toBeCloseTo(2 / 3);
    // (1 час + 24 часа) / 2 = 12,5 часа.
    expect(current.averageMinutesToComplete).toBeCloseTo(12.5 * 60, 0);
    expect(current.funnel).toEqual([
      { status: 'new', count: 0 },
      { status: 'in_progress', count: 0 },
      { status: 'rate_confirmed', count: 0 },
      { status: 'payment_received', count: 0 },
      { status: 'completed', count: 2 },
      { status: 'cancelled', count: 1 },
    ]);
  });

  /*
   * Подана в прошлом периоде, исполнена в этом: оборот здесь, заявка —
   * там. Так конверсия остаётся честной, а деньги — по дате получения.
   */
  it('заявка считается по подаче, деньги — по исполнению', async () => {
    const period = { from: at(7, 0), to: at(0, 0) };
    await givenRequest({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      income: { amount: '2', code: 'USDT' },
      submittedAt: at(10),
      finishedAt: at(3),
    });

    const { current, previous } = await core.summarizeExchangeRequests(admin, period);

    expect(current.submitted).toBe(0);
    expect(current.completed).toBe(1);
    expect(current.turnover).toEqual([{ code: 'USDT', amount: '100', count: 1 }]);
    expect(current.conversion).toBeNull();
    expect(previous.submitted).toBe(1);
    expect(previous.completed).toBe(0);
    expect(previous.turnover).toEqual([]);
  });

  it('предыдущий период — той же длины и до границы', () => {
    const period = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-08T00:00:00Z') };
    expect(previousPeriod(period)).toEqual({
      from: new Date('2026-08-25T00:00:00Z'),
      to: new Date('2026-09-01T00:00:00Z'),
    });
  });

  it('сводка с деньгами — администратору, счётчики — любому сотруднику', async () => {
    const period = { from: at(1, 0), to: at(0, 0) };
    await expect(core.summarizeExchangeRequests(manager, period)).rejects.toThrow(
      /только администратору/,
    );
    await expect(core.countExchangeRequestsFor(manager, period)).resolves.toEqual({
      submitted: 0,
      completed: 0,
      cancelled: 0,
      open: 0,
    });
  });

  it('перевёрнутый период отвергается', async () => {
    await expect(
      core.summarizeExchangeRequests(admin, { from: at(0, 0), to: at(7, 0) }),
    ).rejects.toThrow(/раньше конца/);
  });
});

describe('разрезы', () => {
  it('день без заявок остаётся строкой с нулями, дни — по местному времени', async () => {
    const period = { from: at(3, 0), to: at(0, 0) };
    await givenRequest({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      income: { amount: '2', code: 'USDT' },
      submittedAt: at(2),
      finishedAt: at(2, 13),
    });

    const { byDay } = await core.breakdownExchangeRequests(admin, period, { offsetMinutes: 0 });

    expect(byDay).toHaveLength(3);
    expect(byDay[0]).toEqual({
      day: at(3).toISOString().slice(0, 10),
      submitted: 0,
      completed: 0,
      cancelled: 0,
      turnover: [],
    });
    expect(byDay[1]).toEqual({
      day: at(2).toISOString().slice(0, 10),
      submitted: 1,
      completed: 1,
      cancelled: 0,
      turnover: [{ code: 'USDT', amount: '100', count: 1 }],
    });
  });

  it('переданная заявка считается тому, кто исполнил', async () => {
    // Исполнение происходит «сейчас» — период должен дотянуться до завтра.
    const period = { from: at(3, 0), to: at(-1, 0) };
    const anna = await givenStaff({ displayName: 'Анна' });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
    });
    await core.claimExchangeRequest(manager, request.id);
    await core.reassignExchangeRequest(manager, request.id, { toStaffId: anna.staffId });
    await core.confirmExchangeRate(anna, request.id, {
      finalRate: '80',
      toAmount: '8000',
      paymentInstructions: 'У кассы',
    });
    await core.markPaymentReceived(anna, request.id);
    await core.completeExchangeRequest(anna, request.id, {
      serviceIncome: '3',
      serviceIncomeCode: 'USDT',
    });

    const { byManager } = await core.breakdownExchangeRequests(admin, period);

    expect(byManager).toEqual([
      {
        staffId: anna.staffId,
        displayName: 'Анна',
        completed: 1,
        cancelled: 0,
        open: 0,
        income: [{ code: 'USDT', amount: '3', count: 1 }],
      },
    ]);
  });
});
