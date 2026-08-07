import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  createCore,
  InvalidInputError,
  TransitionNotAllowedError,
  type Actor,
} from './index.js';
import { asClient, givenCurrencyPair, givenServiceAccount, givenStaff, testRequisiteKeys } from './test-support.js';

/**
 * Исполнение заявки на обмен.
 *
 * Доход по заявке — не отчётность, а база всех реферальных начислений
 * (docs/adr/0003). Поэтому исполнить заявку, не назвав его, нельзя: без
 * дохода начислять реферерам не от чего, а дописать его задним числом
 * значило бы пересчитывать уже выплаченное.
 */

const core = createCore({
  db: testDatabase(),
  // Счёт сервиса шифруется фикстурой, а расшифровывает его операция
  // выдачи: ключ у них общий.
  requisites: {
    publicKey: testRequisiteKeys.publicKey,
    privateKey: testRequisiteKeys.privateKey,
  },
});

let manager: Actor & { type: 'staff' };
let requisitesId: string;

async function givenNewRequest(): Promise<string> {
  const { request } = await core.submitExchangeRequest(asClient(100n), {
    kind: 'electronic',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '1000',
    requisitesId,
  });
  return request.id;
}

async function givenRequestAwaitingPayment(): Promise<string> {
  const id = await givenNewRequest();
  await core.claimExchangeRequest(manager, id);
  await core.confirmExchangeRate(manager, id, {
    finalRate: '95.5',
    serviceAccountId: await givenServiceAccount({ currencyCode: 'USDT' }),
  });
  return id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await core.registerClient({ telegramUserId: 100n });
  const requisites = await core.saveRequisites(asClient(100n), {
    kind: 'phone',
    bankName: 'Сбербанк',
    phone: '+79990000000',
  });
  requisitesId = requisites.id;
  manager = await givenStaff();
});

afterAll(() => closeTestDatabase());

describe('поступление оплаты', () => {
  it('отмечается менеджером и видно клиенту', async () => {
    const id = await givenRequestAwaitingPayment();

    const { request, notifications } = await core.markPaymentReceived(manager, id);

    expect(request.status).toBe('payment_received');
    expect(notifications).toEqual([
      expect.objectContaining({ to: 100n, status: 'payment_received' }),
    ]);
  });

  it('не отмечается, пока курс не назван', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(core.markPaymentReceived(manager, id)).rejects.toThrow(
      TransitionNotAllowedError,
    );
  });
});

describe('исполнение заявки', () => {
  it('требует указать доход по заявке', async () => {
    const id = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, id);

    await expect(
      core.completeExchangeRequest(manager, id, { serviceIncome: '', serviceIncomeCode: 'RUB' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('требует, чтобы доход был больше нуля', async () => {
    const id = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, id);

    await expect(
      core.completeExchangeRequest(manager, id, { serviceIncome: '0', serviceIncomeCode: 'RUB' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('требует валюту дохода: без неё сумма ничего не значит', async () => {
    const id = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, id);

    await expect(
      core.completeExchangeRequest(manager, id, { serviceIncome: '500', serviceIncomeCode: ' ' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('требует валюту из справочника: от неё считаются начисления', async () => {
    const id = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, id);

    // «RUR» вместо «RUB» — вторая валюта, в которой у реферера копится
    // отдельный, ни с чем не сходящийся остаток.
    await expect(
      core.completeExchangeRequest(manager, id, {
        serviceIncome: '500',
        serviceIncomeCode: 'RUR',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('сохраняет доход до последнего знака', async () => {
    const id = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, id);

    const { request } = await core.completeExchangeRequest(manager, id, {
      serviceIncome: '0.000000000000000001',
      serviceIncomeCode: 'USDT',
    });

    expect(request.serviceIncome).toBe('0.000000000000000001');
    expect(request.serviceIncomeCode).toBe('USDT');
  });

  it('отмечает время исполнения и сообщает клиенту', async () => {
    const id = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, id);

    const { request, notifications } = await core.completeExchangeRequest(manager, id, {
      serviceIncome: '500',
      serviceIncomeCode: 'RUB',
    });

    expect(request.status).toBe('completed');
    expect(request.completedAt).toBeInstanceOf(Date);
    expect(notifications).toEqual([
      expect.objectContaining({ to: 100n, status: 'completed' }),
    ]);
  });

  it('не показывает клиенту доход по заявке', async () => {
    const id = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, id);
    await core.completeExchangeRequest(manager, id, {
      serviceIncome: '500',
      serviceIncomeCode: 'RUB',
    });

    const seen = await core.getExchangeRequest(asClient(100n), id);

    expect(seen).not.toHaveProperty('serviceIncome');
    expect(seen).not.toHaveProperty('serviceIncomeCode');
  });
});

describe('полный путь заявки', () => {
  it('проходит все состояния, и каждый переход записан с исполнителем', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);
    await core.confirmExchangeRate(manager, id, {
      finalRate: '95.5',
      serviceAccountId: await givenServiceAccount({ currencyCode: 'USDT' }),
    });
    await core.markPaymentReceived(manager, id);
    await core.completeExchangeRequest(manager, id, {
      serviceIncome: '500',
      serviceIncomeCode: 'RUB',
    });

    const events = await core.listExchangeRequestEvents(manager, id);

    expect(
      events.map((event) => ({
        from: event.fromStatus,
        to: event.toStatus,
        by: event.actorStaffId,
        who: event.actorType,
      })),
    ).toEqual([
      { from: null, to: 'new', by: null, who: 'client' },
      { from: 'new', to: 'in_progress', by: manager.staffId, who: 'manager' },
      { from: 'in_progress', to: 'rate_confirmed', by: manager.staffId, who: 'manager' },
      { from: 'rate_confirmed', to: 'payment_received', by: manager.staffId, who: 'manager' },
      { from: 'payment_received', to: 'completed', by: manager.staffId, who: 'manager' },
    ]);
    expect(events.every((event) => event.createdAt instanceof Date)).toBe(true);
  });
});

describe('исполненная заявка', () => {
  it('дальше никуда не переходит', async () => {
    const id = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, id);
    await core.completeExchangeRequest(manager, id, {
      serviceIncome: '500',
      serviceIncomeCode: 'RUB',
    });

    await expect(
      core.cancelExchangeRequest(manager, id, { reason: 'передумали' }),
    ).rejects.toThrow(TransitionNotAllowedError);
    await expect(
      core.completeExchangeRequest(manager, id, {
        serviceIncome: '600',
        serviceIncomeCode: 'RUB',
      }),
    ).rejects.toThrow(TransitionNotAllowedError);
  });
});
