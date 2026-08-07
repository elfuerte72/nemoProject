import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  ConflictError,
  createCore,
  ForbiddenError,
  InvalidInputError,
  TransitionNotAllowedError,
  type Actor,
  type RateQuote,
  type RateSource,
} from './index.js';
import { asClient, givenCurrencyPair, givenServiceAccount, givenStaff, testRequisiteKeys } from './test-support.js';

/**
 * Путь заявки от очереди до подтверждённого курса.
 *
 * Проверяется не «поле status поменялось», а правила, на которых стоит
 * работа менеджеров: одну заявку не могут вести двое, шаги нельзя
 * перепрыгнуть, и о каждом шаге узнаёт клиент. Именно этого ему сегодня
 * и не хватает — он не понимает, что происходит с его переводом.
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

/** Счёт сервиса в USDT: им и платит клиент по заявкам ниже. */
async function usdtAccount(): Promise<string> {
  return givenServiceAccount({ currencyCode: 'USDT' });
}

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
      serviceAccountId: await usdtAccount(),
    });

    expect(request.status).toBe('rate_confirmed');
    expect(request.finalRate).toBe('95.5');
    expect(request.toAmount).toBe('95500');
  });

  it('оставляет реквизиты для оплаты в самой заявке, а не только в сообщении', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);
    await core.confirmExchangeRate(manager, id, {
      finalRate: '95.5',
      serviceAccountId: await usdtAccount(),
    });

    // Клиент возвращается к заявке через день: искать реквизиты в
    // переписке с ботом он не должен.
    const seen = await core.getExchangeRequest(asClient(100n), id);

    // Собранное ядром по счёту, а не набранное менеджером: номер он не
    // набирает вовсе (docs/adr/0008).
    expect(seen.paymentInstructions).toContain('TRC20');
    expect(seen.finalRate).toBe('95.5');
  });

  it('уходит клиенту вместе с реквизитами для оплаты', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    const { notifications } = await core.confirmExchangeRate(manager, id, {
      finalRate: '95.5',
      serviceAccountId: await usdtAccount(),
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        status: 'rate_confirmed',
        finalRate: '95.5',
        paymentInstructions: expect.stringContaining('TRC20') as unknown as string,
      }),
    ]);
  });

  it('не называется чужой заявке', async () => {
    const other = await givenStaff({ displayName: 'Анна' });
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(
      core.confirmExchangeRate(other, id, { finalRate: '95.5', serviceAccountId: await usdtAccount() }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('не называется и администратором, пока заявка закреплена за другим', async () => {
    const admin = await givenStaff({ displayName: 'Владелец', role: 'admin' });
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(
      core.confirmExchangeRate(admin, id, { finalRate: '95.5', serviceAccountId: await usdtAccount() }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('не называется, пока заявку не взяли в работу', async () => {
    const id = await givenNewRequest();

    await expect(
      core.confirmExchangeRate(manager, id, { finalRate: '95.5', serviceAccountId: await usdtAccount() }),
    ).rejects.toThrow(TransitionNotAllowedError);
  });

  it('отвергается, если курс не положительный', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(
      core.confirmExchangeRate(manager, id, { finalRate: '0', serviceAccountId: await usdtAccount() }),
    ).rejects.toThrow(/курс/i);
  });
});

describe('история переходов', () => {
  it('запоминает, кто и когда менял состояние', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);
    await core.confirmExchangeRate(manager, id, {
      finalRate: '95.5',
      serviceAccountId: await usdtAccount(),
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
      core.confirmExchangeRate(client, id, { finalRate: '95', serviceAccountId: await usdtAccount() }),
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

/**
 * Курс заявки — обязательство сервиса (docs/adr/0006).
 *
 * Правило различается по способу: безналичную заявку определяет курс
 * подачи, наличную котирует менеджер — котировок наличного рынка у
 * сервиса нет. Проверяется здесь именно это различие, потому что от
 * него зависит, ту ли цену клиент увидит в итоге.
 */
describe('курс заявки', () => {
  /** Источник, отвечающий одной котировкой на любую пару. */
  const rateSource: RateSource = {
    async quote(): Promise<RateQuote> {
      return { rate: '100' as RateQuote['rate'], asOf: new Date('2026-01-01T00:00:00Z') };
    },
  };
  const withRate = createCore({
    db: testDatabase(),
    rateSource,
    requisites: {
      publicKey: testRequisiteKeys.publicKey,
      privateKey: testRequisiteKeys.privateKey,
    },
  });

  /** Безналичная заявка, поданная при живом источнике котировок. */
  async function givenRequestWithRate(): Promise<string> {
    const { request } = await withRate.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
      requisitesId,
    });
    await withRate.claimExchangeRequest(manager, request.id);
    return request.id;
  }

  it('записывается в заявку при подаче', async () => {
    const id = await givenRequestWithRate();

    const seen = await withRate.getExchangeRequest(asClient(100n), id);

    // Наценка по умолчанию — 2%, и курс с ней клиент и видел: 100 − 2%.
    expect(seen.requestRate).toBe('98');
  });

  it('не меняется при подтверждении: менеджер работает по курсу подачи', async () => {
    const id = await givenRequestWithRate();

    const { request } = await withRate.confirmExchangeRate(manager, id, {
      serviceAccountId: await usdtAccount(),
    });

    expect(request.finalRate).toBe('98');
  });

  it('не подменяется другим числом: менеджер узнаёт об этом до клиента', async () => {
    const id = await givenRequestWithRate();

    await expect(
      withRate.confirmExchangeRate(manager, id, {
        finalRate: '90',
        serviceAccountId: await usdtAccount(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('называется менеджером там, где курса подачи нет', async () => {
    // Наличные: котировок наличного рынка у сервиса нет вовсе.
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    const { request } = await withRate.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
    });
    await withRate.claimExchangeRequest(manager, request.id);

    const confirmed = await withRate.confirmExchangeRate(manager, request.id, {
      finalRate: '93',
      paymentInstructions: 'наличными в офисе',
    });

    expect(confirmed.request.requestRate).toBeNull();
    expect(confirmed.request.finalRate).toBe('93');
  });

  it('требует курса от менеджера, когда его нет у заявки', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(manager, id);

    await expect(
      core.confirmExchangeRate(manager, id, { paymentInstructions: 'TRC20: TXYZ...' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('запоминает момент выдачи реквизитов: от него идёт срок оплаты', async () => {
    const id = await givenRequestWithRate();

    const { request } = await withRate.confirmExchangeRate(manager, id, {
      serviceAccountId: await usdtAccount(),
    });

    expect(request.requisitesIssuedAt).toBeInstanceOf(Date);
  });
});
