import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  createCore,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  TransitionNotAllowedError,
  type Actor,
} from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Отмена заявки.
 *
 * Клиент вправе передумать, пока его заявкой никто не занялся. Дальше в
 * дело вступил менеджер — и отменить может только он, назвав причину:
 * клиент, чью заявку отменили молча, не понимает, что делать дальше, и
 * идёт выяснять это в поддержку.
 */

const core = createCore({ db: testDatabase() });

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

describe('отмена клиентом', () => {
  it('доступна, пока заявку никто не взял', async () => {
    const id = await givenNewRequest();

    const { request } = await core.cancelOwnExchangeRequest(asClient(100n), id);

    expect(request.status).toBe('cancelled');
  });

  it('недоступна после того, как заявку взяли в работу', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(core.cancelOwnExchangeRequest(asClient(100n), id)).rejects.toThrow(
      TransitionNotAllowedError,
    );
  });

  it('не распространяется на чужие заявки', async () => {
    await core.registerClient({ telegramUserId: 200n });
    const id = await givenNewRequest();

    await expect(core.cancelOwnExchangeRequest(asClient(200n), id)).rejects.toThrow(NotFoundError);
  });

  it('не требует объяснений', async () => {
    const id = await givenNewRequest();

    const { request } = await core.cancelOwnExchangeRequest(asClient(100n), id);

    expect(request.cancelReason).toBeNull();
  });

  it('возвращает заявку без дохода по ней: это внутренняя величина', async () => {
    const id = await givenNewRequest();

    const { request } = await core.cancelOwnExchangeRequest(asClient(100n), id);

    expect(request).not.toHaveProperty('serviceIncome');
  });

  it('не выполняется через операцию менеджера', async () => {
    const id = await givenNewRequest();

    await expect(
      core.cancelExchangeRequest(asClient(100n), id, { reason: 'передумал' }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('отмена менеджером', () => {
  it('требует причину', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(core.cancelExchangeRequest(manager, id, { reason: '  ' })).rejects.toThrow(
      InvalidInputError,
    );
  });

  it('доступна из любого незавершённого состояния', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);
    await core.confirmExchangeRate(manager, id, {
      finalRate: '95',
      paymentInstructions: 'TRC20: TXYZ',
    });
    await core.markPaymentReceived(manager, id);

    const { request } = await core.cancelExchangeRequest(manager, id, {
      reason: 'клиент прислал меньше',
    });

    expect(request.status).toBe('cancelled');
  });

  it('доносит причину до клиента', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    const { notifications } = await core.cancelExchangeRequest(manager, id, {
      reason: 'направление временно недоступно',
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        to: 100n,
        status: 'cancelled',
        cancelReason: 'направление временно недоступно',
      }),
    ]);
  });

  it('оставляет причину видимой клиенту в самой заявке', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);
    await core.cancelExchangeRequest(manager, id, { reason: 'не прошла проверка' });

    const seen = await core.getExchangeRequest(asClient(100n), id);

    expect(seen.cancelReason).toBe('не прошла проверка');
  });
});

describe('отменённая заявка', () => {
  it('дальше никуда не переходит', async () => {
    const id = await givenNewRequest();
    await core.cancelOwnExchangeRequest(asClient(100n), id);

    // Именно «переход запрещён», а не «заявку уже взяли»: менеджеру,
    // открывшему отменённую заявку, нельзя сообщать, что её забрал
    // коллега, — он пойдёт этого коллегу искать.
    await expect(core.claimExchangeRequest(manager, id)).rejects.toThrow(
      TransitionNotAllowedError,
    );
    await expect(
      core.completeExchangeRequest(manager, id, {
        serviceIncome: '500',
        serviceIncomeCode: 'RUB',
      }),
    ).rejects.toThrow(TransitionNotAllowedError);
  });

  it('записана в историю наравне с остальными переходами', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);
    await core.cancelExchangeRequest(manager, id, { reason: 'дубль заявки' });

    const events = await core.listExchangeRequestEvents(manager, id);

    expect(events.at(-1)).toMatchObject({
      fromStatus: 'in_progress',
      toStatus: 'cancelled',
      actorStaffId: manager.staffId,
      comment: 'дубль заявки',
    });
  });
});
