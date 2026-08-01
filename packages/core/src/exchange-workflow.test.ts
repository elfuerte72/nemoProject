import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  ConflictError,
  createCore,
  ForbiddenError,
  TransitionNotAllowedError,
  type Actor,
} from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Путь заявки от очереди до подтверждённого курса.
 *
 * Проверяется не «поле status поменялось», а правила, на которых стоит
 * работа менеджеров: одну заявку не могут вести двое, шаги нельзя
 * перепрыгнуть, и о каждом шаге узнаёт клиент. Именно этого ему сегодня
 * и не хватает — он не понимает, что происходит с его переводом.
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
  const requisites = await core.saveRequisites(asClient(100n), { phone: '+79990000000' });
  requisitesId = requisites.id;
  manager = await givenStaff({ displayName: 'Пётр' });
});

afterAll(() => closeTestDatabase());

describe('очередь', () => {
  it('показывает заявки, которых никто не взял', async () => {
    const waiting = await givenNewRequest();
    const taken = await givenNewRequest();
    await core.claimExchangeRequest(manager, taken);

    const queue = await core.listExchangeRequestQueue(manager);

    expect(queue.map((request) => request.id)).toEqual([waiting]);
  });

  it('не открывается клиенту', async () => {
    await expect(core.listExchangeRequestQueue(asClient(100n))).rejects.toThrow(ForbiddenError);
  });
});

describe('взятие заявки', () => {
  it('закрепляет её за менеджером', async () => {
    const id = await givenNewRequest();

    const { request } = await core.claimExchangeRequest(manager, id);

    expect(request.status).toBe('in_progress');
    expect(request.assignedManagerId).toBe(manager.staffId);
  });

  it('не даёт второму менеджеру взять ту же заявку', async () => {
    const other = await givenStaff({ displayName: 'Анна' });
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(core.claimExchangeRequest(other, id)).rejects.toThrow(ConflictError);
  });

  it('сообщает клиенту, что заявку взяли', async () => {
    const id = await givenNewRequest();

    const { notifications } = await core.claimExchangeRequest(manager, id);

    expect(notifications).toEqual([
      expect.objectContaining({
        kind: 'exchange-request-status',
        to: 100n,
        status: 'in_progress',
      }),
    ]);
  });
});

describe('финальный курс', () => {
  it('переводит заявку в ожидание оплаты', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    const { request } = await core.confirmExchangeRate(manager, id, {
      finalRate: '95.5',
      toAmount: '95500',
      paymentInstructions: 'TRC20: TXYZ...',
    });

    expect(request.status).toBe('rate_confirmed');
    expect(request.finalRate).toBe('95.5');
    expect(request.toAmount).toBe('95500');
  });

  it('уходит клиенту вместе с реквизитами для оплаты', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    const { notifications } = await core.confirmExchangeRate(manager, id, {
      finalRate: '95.5',
      paymentInstructions: 'TRC20: TXYZ...',
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        status: 'rate_confirmed',
        finalRate: '95.5',
        paymentInstructions: 'TRC20: TXYZ...',
      }),
    ]);
  });

  it('не называется чужой заявке', async () => {
    const other = await givenStaff({ displayName: 'Анна' });
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(
      core.confirmExchangeRate(other, id, { finalRate: '95.5', paymentInstructions: 'x' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('не называется и администратором, пока заявка закреплена за другим', async () => {
    const admin = await givenStaff({ displayName: 'Владелец', role: 'admin' });
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(
      core.confirmExchangeRate(admin, id, { finalRate: '95.5', paymentInstructions: 'x' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('не называется, пока заявку не взяли в работу', async () => {
    const id = await givenNewRequest();

    await expect(
      core.confirmExchangeRate(manager, id, { finalRate: '95.5', paymentInstructions: 'x' }),
    ).rejects.toThrow(TransitionNotAllowedError);
  });

  it('отвергается, если курс не положительный', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(
      core.confirmExchangeRate(manager, id, { finalRate: '0', paymentInstructions: 'x' }),
    ).rejects.toThrow(/курс/i);
  });
});

describe('история переходов', () => {
  it('запоминает, кто и когда менял состояние', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);
    await core.confirmExchangeRate(manager, id, {
      finalRate: '95.5',
      paymentInstructions: 'x',
    });

    const events = await core.listExchangeRequestEvents(manager, id);

    expect(
      events.map((event) => ({
        from: event.fromStatus,
        to: event.toStatus,
        by: event.actorStaffId,
      })),
    ).toEqual([
      { from: null, to: 'new', by: null },
      { from: 'new', to: 'in_progress', by: manager.staffId },
      { from: 'in_progress', to: 'rate_confirmed', by: manager.staffId },
    ]);
    expect(events.at(-1)!.createdAt).toBeInstanceOf(Date);
  });

  it('не открывается клиенту: это внутренняя кухня сервиса', async () => {
    const id = await givenNewRequest();

    await expect(core.listExchangeRequestEvents(asClient(100n), id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe('запрещённые переходы', () => {
  it('не позволяют исполнить заявку, минуя оплату', async () => {
    const id = await givenNewRequest();

    await expect(
      core.completeExchangeRequest(manager, id, {
        serviceIncome: '500',
        serviceIncomeCode: 'RUB',
      }),
    ).rejects.toThrow(TransitionNotAllowedError);
  });
});

describe('состояние заявки в руках клиента', () => {
  it('не меняется ничем, кроме отмены новой', async () => {
    const id = await givenNewRequest();
    const client = asClient(100n);

    // Всё, что делает менеджер, клиенту недоступно — включая заявку,
    // которую подал он сам: иначе он объявил бы собственный курс или
    // отметил бы оплату, которой не было.
    await expect(core.claimExchangeRequest(client, id)).rejects.toThrow(ForbiddenError);
    await expect(
      core.confirmExchangeRate(client, id, { finalRate: '95', paymentInstructions: 'x' }),
    ).rejects.toThrow(ForbiddenError);
    await expect(core.markPaymentReceived(client, id)).rejects.toThrow(ForbiddenError);
    await expect(
      core.completeExchangeRequest(client, id, {
        serviceIncome: '500',
        serviceIncomeCode: 'RUB',
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('не меняется и в чужой заявке', async () => {
    await core.registerClient({ telegramUserId: 200n });
    const id = await givenNewRequest();

    await expect(core.claimExchangeRequest(asClient(200n), id)).rejects.toThrow(ForbiddenError);
  });
});
