import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  createCore,
  InvalidInputError,
  TransitionNotAllowedError,
  type Actor,
} from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Завершение сделки.
 *
 * Доход по заявке — не отчётность, а база всех реферальных начислений
 * (docs/adr/0003). Поэтому исполнить заявку, не назвав его, нельзя: без
 * дохода начислять реферерам не от чего, а дописать его задним числом
 * значило бы пересчитывать уже выплаченное.
 */

const core = createCore({ db: testDatabase() });

let manager: Actor & { type: 'staff' };

async function givenRequestAwaitingPayment(): Promise<string> {
  const { request } = await core.submitExchangeRequest(asClient(100n), {
    kind: 'electronic',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '1000',
  });
  await core.claimExchangeRequest(manager, request.id);
  await core.confirmExchangeRate(manager, request.id, {
    finalRate: '95.5',
    paymentInstructions: 'TRC20: TXYZ',
  });
  return request.id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await core.registerClient({ telegramUserId: 100n });
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
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
    });
    await core.claimExchangeRequest(manager, request.id);

    await expect(core.markPaymentReceived(manager, request.id)).rejects.toThrow(
      TransitionNotAllowedError,
    );
  });
});

describe('исполнение заявки', () => {
  it('требует указать доход сервиса', async () => {
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

  it('не показывает клиенту доход сервиса', async () => {
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
