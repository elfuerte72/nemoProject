import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { exchangeRequests } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, EXPIRED_REASON, type Actor } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenMerchant,
  givenNetwork,
  givenStaff,
  testRequisiteKeys,
} from './test-support.js';

/**
 * Разрезы мерчанта — та же арифметика, что у сводки (docs/adr/0013):
 * подано по дате подачи, исполнено и деньги по дате исполнения, отмены
 * по дате отмены, валюты не складываются. Проверяется здесь не она, а
 * то, по чему заявки раскладываются: направление, способ выдачи,
 * получатель, источник, час и день недели, — и что чужая заявка в эти
 * числа не попадает.
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
const OTHER_CARD = { kind: 'card', bankName: 'Т-Банк', cardNumber: '5555555555554444' } as const;
const WALLET = {
  kind: 'wallet',
  network: 'TRC20',
  address: 'TN3W4H6rK2ce4vX9YnFQHwKENnHjJ8nZ3f',
} as const;

type Payout = typeof CARD | typeof OTHER_CARD | typeof WALLET;

/** Заявка операциями, а не строкой: сцена должна быть достижимой. */
async function givenRequest(input: {
  owner: Actor;
  fromCode: string;
  toCode: string;
  fromAmount: string;
  fate: 'completed' | 'cancelled' | 'open';
  submittedAt: Date;
  finishedAt?: Date;
  payout?: Payout;
  source?: 'miniapp' | 'cabinet' | 'api';
}): Promise<string> {
  const payout = input.payout ?? (input.toCode === 'USDT' ? WALLET : CARD);
  const { request } = await core.submitExchangeRequest(input.owner, {
    kind: 'electronic',
    fromCode: input.fromCode,
    toCode: input.toCode,
    fromAmount: input.fromAmount,
    payout,
    ...(input.source === undefined ? {} : { source: input.source }),
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

const period = () => ({ from: at(7, 0), to: at(0, 0) });

describe('разрезы мерчанта', () => {
  it('раскладывает по направлениям, считая деньги по дате исполнения', async () => {
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
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '40',
      fate: 'cancelled',
      submittedAt: at(4),
      finishedAt: at(4, 15),
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

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    expect(cut.byDirection).toEqual([
      {
        fromCode: 'USDT',
        toCode: 'RUB',
        kind: 'electronic',
        submitted: 2,
        completed: 1,
        cancelled: 1,
        converted: 1,
        turnover: [{ code: 'USDT', amount: '100', count: 1 }],
      },
      {
        fromCode: 'RUB',
        toCode: 'USDT',
        kind: 'electronic',
        submitted: 1,
        completed: 1,
        cancelled: 0,
        converted: 1,
        turnover: [{ code: 'RUB', amount: '50000', count: 1 }],
      },
    ]);
  });

  it('конверсия строки считается по поданным в ней, а не делением двух чисел', async () => {
    // Подана до периода, исполнена внутри: в «исполнено» строки она
    // попадает, в конверсию — нет. Делить одно на другое значило бы
    // показать четыреста процентов в неделю, когда разгребли хвост.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '300',
      fate: 'completed',
      submittedAt: at(9),
      finishedAt: at(3),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'open',
      submittedAt: at(2),
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    const line = cut.byDirection[0];
    expect(line).toMatchObject({ submitted: 1, completed: 1, converted: 0 });
    expect(line!.converted / line!.submitted).toBeLessThanOrEqual(1);
  });

  it('раскладывает по способу выдачи и по получателю', async () => {
    await givenRequest({
      owner: merchant,
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '50000',
      fate: 'completed',
      submittedAt: at(5),
      finishedAt: at(5, 13),
      payout: WALLET,
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(4),
      finishedAt: at(4, 13),
      payout: CARD,
    });
    // Та же карта вторым заходом: по API получатель заводится записью
    // на каждую заявку, и разрез по записям дал бы две строки об одном
    // человеке.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '200',
      fate: 'open',
      submittedAt: at(3),
      payout: CARD,
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '70',
      fate: 'open',
      submittedAt: at(2),
      payout: OTHER_CARD,
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    expect(cut.byPayoutMethod).toEqual([
      {
        method: 'bank',
        submitted: 3,
        completed: 1,
        cancelled: 0,
        converted: 1,
        turnover: [{ code: 'USDT', amount: '100', count: 1 }],
      },
      {
        method: 'wallet',
        submitted: 1,
        completed: 1,
        cancelled: 0,
        converted: 1,
        turnover: [{ code: 'RUB', amount: '50000', count: 1 }],
      },
    ]);

    // Карта та же — строка одна, на две заявки.
    const sber = cut.byRecipient.find((one) => one.bankName === 'Сбербанк');
    expect(sber).toMatchObject({ kind: 'card', cardLast4: '1111', submitted: 2, completed: 1 });
    expect(cut.byRecipient).toHaveLength(3);
  });

  it('раскладывает по источнику, и у заявки без отметки источник пуст', async () => {
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(5),
      finishedAt: at(5, 13),
      source: 'api',
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '60',
      fate: 'open',
      submittedAt: at(4),
      source: 'api',
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '50',
      fate: 'open',
      submittedAt: at(3),
      source: 'cabinet',
    });
    // Поданная до появления отметки: источник неизвестен, и выдуманного
    // у неё быть не должно.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '40',
      fate: 'open',
      submittedAt: at(2),
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    expect(cut.bySource).toEqual([
      {
        source: 'api',
        submitted: 2,
        completed: 1,
        cancelled: 0,
        converted: 1,
        turnover: [{ code: 'USDT', amount: '100', count: 1 }],
      },
      { source: 'cabinet', submitted: 1, completed: 0, cancelled: 0, converted: 0, turnover: [] },
      { source: null, submitted: 1, completed: 0, cancelled: 0, converted: 0, turnover: [] },
    ]);
  });

  /**
   * Разрез по тому, кто подал (тикет 17). Заявка по ключу API ничья:
   * ключ принадлежит организации, и назвать её автором того, кто ключ
   * выпустил, значило бы записать в историю чужую работу.
   */
  it('раскладывает по тому, кто подал, а заявку по ключу оставляет ничьей', async () => {
    const added = await core.addMerchantUser(merchant, {
      email: 'anna@example.com',
      password: 'правильная лошадь батарейка',
      name: 'Анна',
      role: 'operator',
    });
    const operator = {
      type: 'merchant',
      merchantId: merchant.merchantId,
      userId: added.id,
      role: 'operator',
    } as const;
    const byKey = {
      type: 'merchant',
      merchantId: merchant.merchantId,
      userId: null,
      role: 'operator',
    } as const;

    await givenRequest({
      owner: operator,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(5),
      finishedAt: at(5, 13),
    });
    await givenRequest({
      owner: operator,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '60',
      fate: 'open',
      submittedAt: at(4),
    });
    await givenRequest({
      owner: byKey,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '50',
      fate: 'open',
      submittedAt: at(3),
      source: 'api',
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    expect(cut.byStaff).toEqual([
      {
        userId: added.id,
        name: 'Анна',
        role: 'operator',
        submitted: 2,
        completed: 1,
        cancelled: 0,
        converted: 1,
        turnover: [{ code: 'USDT', amount: '100', count: 1 }],
      },
      {
        userId: null,
        name: null,
        role: null,
        submitted: 1,
        completed: 0,
        cancelled: 0,
        converted: 0,
        turnover: [],
      },
    ]);
  });

  it('строит динамику по дням периода, оставляя пустые дни на месте', async () => {
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
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '40',
      fate: 'cancelled',
      submittedAt: at(5, 9),
      finishedAt: at(4, 15),
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    expect(cut.step).toBe('day');
    expect(cut.series).toHaveLength(7);
    const busy = cut.series.find((one) => one.at === dayKeyOf(at(5)));
    expect(busy).toMatchObject({ submitted: 2, completed: 1, cancelled: 0 });
    expect(busy?.turnover).toEqual([{ code: 'USDT', amount: '100', count: 1 }]);
    const cancelDay = cut.series.find((one) => one.at === dayKeyOf(at(4)));
    expect(cancelDay).toMatchObject({ submitted: 0, completed: 0, cancelled: 1 });
    // День без заявок остаётся строкой с нулями, а не пропадает.
    expect(cut.series.filter((one) => one.submitted === 0 && one.cancelled === 0)).toHaveLength(5);
  });

  it('считает часы и дни недели по часам того, кто смотрит', async () => {
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'open',
      submittedAt: at(3, 21),
    });

    const utc = await core.breakdownMerchant(merchant, merchant.merchantId, period());
    expect(utc.byHour[21]).toEqual({ hour: 21, submitted: 1 });
    expect(utc.byHour).toHaveLength(24);

    // Бангкок: +7 часов — та же заявка уходит в следующие сутки, в 4 утра.
    const bangkok = await core.breakdownMerchant(merchant, merchant.merchantId, period(), {
      offsetMinutes: 7 * 60,
    });
    expect(bangkok.byHour[4]).toEqual({ hour: 4, submitted: 1 });
    expect(bangkok.byWeekday).toHaveLength(7);
    expect(bangkok.byWeekday.reduce((sum, one) => sum + one.submitted, 0)).toBe(1);
  });

  it('называет рекорды периода', async () => {
    const big = await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '900',
      fate: 'completed',
      submittedAt: at(5),
      // Сутки от подачи до исполнения — самая долгая.
      finishedAt: at(4),
    });
    const quick = await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(3),
      finishedAt: at(3, 13),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '50000',
      fate: 'completed',
      submittedAt: at(2),
      finishedAt: at(2, 15),
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    // Крупнейшая — по каждой валюте отдачи своя: складывать их нечем.
    expect(cut.records.largest).toEqual([
      { code: 'RUB', amount: '50000', requestId: expect.any(String), reference: null },
      { code: 'USDT', amount: '900', requestId: big, reference: null },
    ]);
    expect(cut.records.fastest?.requestId).toBe(quick);
    expect(cut.records.fastest?.minutes).toBeCloseTo(60, 0);
    expect(cut.records.slowest?.requestId).toBe(big);
    expect(cut.records.slowest?.minutes).toBeCloseTo(24 * 60, 0);
    expect(cut.records.busiestStep).toMatchObject({ submitted: 1 });
  });

  it('строит воронку поданных в период и отделяет просроченные от отменённых', async () => {
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(5),
      finishedAt: at(5, 13),
    });
    const expired = await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '40',
      fate: 'cancelled',
      submittedAt: at(4),
      finishedAt: at(4, 15),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '70',
      fate: 'cancelled',
      submittedAt: at(3),
      finishedAt: at(3, 15),
    });
    // Отмена по сроку — та же отмена, но причина у неё своя, и в
    // воронке она стоит отдельной строкой.
    await db
      .update(exchangeRequests)
      .set({ cancelReason: EXPIRED_REASON })
      .where(eq(exchangeRequests.id, expired));

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    const byStatus = new Map(cut.funnel.stages.map((one) => [one.status, one.count]));
    expect(byStatus.get('completed')).toBe(1);
    expect(byStatus.get('cancelled')).toBe(2);
    expect(cut.funnel.expired).toBe(1);
    // Ступени все, включая нулевые: пропавшая читалась бы как «такого не было».
    expect(cut.funnel.stages).toHaveLength(6);
  });

  it('чужие заявки в разрезы не попадают', async () => {
    const other = await givenMerchant({ email: 'other@example.com' });
    await givenRequest({
      owner: other,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '900',
      fate: 'completed',
      submittedAt: at(5),
      finishedAt: at(5, 13),
    });
    await givenRequest({
      owner: asClient(100n),
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '800',
      fate: 'completed',
      submittedAt: at(4),
      finishedAt: at(4, 13),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(3),
      finishedAt: at(3, 13),
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    expect(cut.byDirection).toEqual([
      {
        fromCode: 'USDT',
        toCode: 'RUB',
        kind: 'electronic',
        submitted: 1,
        completed: 1,
        cancelled: 0,
        converted: 1,
        turnover: [{ code: 'USDT', amount: '100', count: 1 }],
      },
    ]);
    expect(cut.byRecipient).toHaveLength(1);
  });

  it('незнакомый шаг сетки отвергается, а не уходит в запрос', async () => {
    // Шаг подставляется в запрос литералом через `sql.raw`, и типа на
    // границе операции нет: снаружи в неё летит то, что пришло из
    // адресной строки.
    await expect(
      core.breakdownMerchant(merchant, merchant.merchantId, period(), {
        step: "day'; drop table exchange_requests; --" as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('чужие разрезы мерчанту не отдаются', async () => {
    const other = await givenMerchant({ email: 'other@example.com' });
    await expect(
      core.breakdownMerchant(merchant, other.merchantId, period()),
    ).rejects.toThrow(/не найден/i);
  });
});

/**
 * Разрезы раздела «Аналитика», собранного по образцу Love&Pay
 * (24 сентября 2026): отбор «только я», получатели как клиенты —
 * сколько их, кто новый и кто вернулся, — валюты с обеих сторон,
 * карта нагрузки, лучший день и медианы. Арифметика та же, ADR-0013.
 */
describe('разрезы аналитики по образцу Love&Pay', () => {
  it('по отбору «только я» считает поданное этим человеком', async () => {
    const added = await core.addMerchantUser(merchant, {
      email: 'anna@example.com',
      password: 'правильная лошадь батарейка',
      name: 'Анна',
      role: 'operator',
    });
    const anna = {
      type: 'merchant',
      merchantId: merchant.merchantId,
      userId: added.id,
      role: 'operator',
    } as const;
    await givenRequest({
      owner: anna,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(5),
      finishedAt: at(5, 13),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '900',
      fate: 'completed',
      submittedAt: at(4),
      finishedAt: at(4, 13),
      payout: OTHER_CARD,
    });
    await givenRequest({
      owner: { ...anna, userId: null },
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '50000',
      fate: 'open',
      submittedAt: at(3),
      source: 'api',
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period(), {
      submittedBy: added.id,
    });

    expect(cut.byStaff.map((one) => one.name)).toEqual(['Анна']);
    expect(cut.byDirection).toHaveLength(1);
    expect(cut.series.reduce((total, one) => total + one.submitted, 0)).toBe(1);
    expect(cut.funnel.stages.reduce((total, one) => total + one.count, 0)).toBe(1);
    expect(cut.records.largest).toEqual([
      { code: 'USDT', amount: '100', requestId: expect.any(String), reference: null },
    ]);
    expect(cut.recipients).toEqual({ total: 1, fresh: 1, returning: 0 });
  });

  /**
   * Получатель в аналитике — то, чем у Love&Pay служит клиент: сколько
   * их за период, сколько пришли впервые и сколько вернулись. Новый —
   * тот, кому мерчант прежде не подавал ни одной заявки, а не тот, кто
   * впервые попал в выбранные дни.
   */
  it('считает получателей: всего, новых и вернувшихся, и когда им подавали последний раз', async () => {
    // Карта Сбербанка знакома с прошлого месяца — в период она пришла
    // не новой, хоть и заявка по ней в нём одна.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(30),
      finishedAt: at(30, 13),
      payout: CARD,
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(5),
      finishedAt: at(5, 13),
      payout: CARD,
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '40',
      fate: 'open',
      submittedAt: at(4),
      payout: OTHER_CARD,
    });
    const later = at(2, 15);
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '60',
      fate: 'open',
      submittedAt: later,
      payout: OTHER_CARD,
    });
    // Кошелёк дважды за период, но впервые: он новый, а не вернувшийся.
    // Вернувшийся — тот, кому подавали и до периода, а не тот, кому
    // подали в нём больше одной заявки.
    await givenRequest({
      owner: merchant,
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '50000',
      fate: 'open',
      submittedAt: at(1),
      payout: WALLET,
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '30000',
      fate: 'open',
      submittedAt: at(1, 15),
      payout: WALLET,
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    expect(cut.recipients).toEqual({ total: 3, fresh: 2, returning: 1 });
    const tbank = cut.byRecipient.find((one) => one.bankName === 'Т-Банк');
    expect(tbank).toMatchObject({ submitted: 2, fresh: true });
    expect(tbank?.lastSubmittedAt?.getTime()).toBe(later.getTime());
    const sber = cut.byRecipient.find((one) => one.bankName === 'Сбербанк');
    expect(sber).toMatchObject({ submitted: 1, fresh: false });
  });

  it('раскладывает деньги по валютам: сколько отдано и сколько получено', async () => {
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
      fromAmount: '8000',
      fate: 'completed',
      submittedAt: at(4),
      finishedAt: at(4, 13),
    });
    // Незавершённая ни в отданное, ни в полученное не идёт.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '70',
      fate: 'open',
      submittedAt: at(3),
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    // Курс сцены — «80», и названный курс операция умножает на отданное
    // в любую сторону: сто USDT дают 8 000 RUB, 8 000 RUB — 640 000 USDT.
    // Правдоподобие курса здесь ни при чём — проверяется, что отданное
    // и полученное легли каждое в свою валюту.
    expect(cut.byCurrency).toEqual([
      {
        code: 'RUB',
        given: { amount: '8000', count: 1 },
        received: { amount: '8000', count: 1 },
      },
      {
        code: 'USDT',
        given: { amount: '100', count: 1 },
        received: { amount: '640000', count: 1 },
      },
    ]);
  });

  it('строит карту нагрузки по дням недели и часам того, кто смотрит', async () => {
    const moment = at(3, 10);
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'open',
      submittedAt: moment,
    });

    const bangkok = await core.breakdownMerchant(merchant, merchant.merchantId, period(), {
      offsetMinutes: 7 * 60,
    });

    expect(bangkok.load).toHaveLength(7);
    expect(bangkok.load.every((row) => row.length === 24)).toBe(true);
    const local = new Date(moment.getTime() + 7 * 60 * 60 * 1000);
    const weekday = (local.getUTCDay() + 6) % 7;
    expect(bangkok.load[weekday]?.[local.getUTCHours()]).toBe(1);
    expect(bangkok.load.flat().reduce((total, one) => total + one, 0)).toBe(1);
  });

  it('считает получателей на каждом шаге динамики', async () => {
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'open',
      submittedAt: at(3, 9),
      payout: CARD,
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'open',
      submittedAt: at(3, 11),
      payout: CARD,
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'open',
      submittedAt: at(3, 13),
      payout: OTHER_CARD,
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period());

    const day = cut.series.find((one) => one.at === dayKeyOf(at(3)));
    expect(day).toMatchObject({ submitted: 3, recipients: 2 });
    expect(cut.series.filter((one) => one.at !== day?.at).every((one) => one.recipients === 0)).toBe(
      true,
    );
  });

  it('называет лучший день, медиану чека и медиану срока исполнения', async () => {
    // Два исполнения в один день — он и лучший, какой бы шаг ни был выбран.
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      fate: 'completed',
      submittedAt: at(5, 9),
      finishedAt: at(5, 10),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '900',
      fate: 'completed',
      submittedAt: at(5, 11),
      finishedAt: at(5, 14),
    });
    await givenRequest({
      owner: merchant,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '300',
      fate: 'completed',
      submittedAt: at(2, 9),
      finishedAt: at(2, 11),
    });

    const cut = await core.breakdownMerchant(merchant, merchant.merchantId, period(), {
      step: 'week',
    });

    expect(cut.records.bestDay).toEqual({ at: dayKeyOf(at(5)), completed: 2 });
    // Медиана — середина ряда 100, 300, 900: тройка заявок, а не среднее.
    expect(cut.medianTicket).toEqual([{ code: 'USDT', amount: '300' }]);
    // Сроки 60, 120 и 180 минут: середина — два часа.
    expect(cut.records.medianMinutes).toBeCloseTo(120, 0);
  });
});

/** День по UTC — тем же ключом, каким его называет разрез. */
function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}
