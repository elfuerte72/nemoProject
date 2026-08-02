import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  ConflictError,
  createCore,
  ForbiddenError,
  NotFoundError,
  TransitionNotAllowedError,
  type Actor,
} from './index.js';
import { asClient, givenStaff } from './test-support.js';

/**
 * Заявка на виртуальную карту.
 *
 * Сервис карту не выпускает — он ведёт состояние заявки, поданной
 * внешнему провайдеру (docs/adr/0004). Поэтому проверять здесь нечего,
 * кроме самого пути состояний и того, что клиент о каждом шаге узнаёт.
 */

const core = createCore({ db: testDatabase() });

let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  await core.registerClient({ telegramUserId: 100n });
  manager = await givenStaff();
});

afterAll(() => closeTestDatabase());

describe('отзыв клиентом', () => {
  it('доступен, пока провайдер за заявку не взялся', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));

    const { application: cancelled, notifications } = await core.cancelOwnCardApplication(
      asClient(100n),
      application.id,
    );

    expect(cancelled.status).toBe('cancelled');
    expect(notifications).toEqual([
      { kind: 'card-application-status', to: 100n, status: 'cancelled' },
    ]);
  });

  it('после отзыва можно подать новую: место занято не осталось', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));
    await core.cancelOwnCardApplication(asClient(100n), application.id);

    const { application: second } = await core.submitCardApplication(asClient(100n));

    expect(second.status).toBe('submitted');
  });

  it('невозможен, когда заявку уже ведёт провайдер', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));
    await core.updateCardApplicationStatus(manager, application.id, { status: 'processing' });

    await expect(
      core.cancelOwnCardApplication(asClient(100n), application.id),
    ).rejects.toThrow(TransitionNotAllowedError);
  });

  it('чужую заявку не находит: её существование не подтверждается', async () => {
    await core.registerClient({ telegramUserId: 200n });
    const { application } = await core.submitCardApplication(asClient(100n));

    await expect(
      core.cancelOwnCardApplication(asClient(200n), application.id),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('подача заявки', () => {
  it('принимается и сообщается клиенту', async () => {
    const { application, notifications } = await core.submitCardApplication(asClient(100n));

    expect(application.status).toBe('submitted');
    expect(notifications).toEqual([
      { kind: 'card-application-status', to: 100n, status: 'submitted' },
    ]);
  });

  it('не создаётся второй раз, пока карта активна', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));
    await core.updateCardApplicationStatus(manager, application.id, { status: 'processing' });
    await core.updateCardApplicationStatus(manager, application.id, { status: 'active' });

    await expect(core.submitCardApplication(asClient(100n))).rejects.toThrow(ConflictError);
  });

  it('не создаётся второй раз, пока первая в работе', async () => {
    await core.submitCardApplication(asClient(100n));

    await expect(core.submitCardApplication(asClient(100n))).rejects.toThrow(ConflictError);
  });

  it('подаётся заново после отказа', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));
    await core.updateCardApplicationStatus(manager, application.id, { status: 'rejected' });

    const retried = await core.submitCardApplication(asClient(100n));

    expect(retried.application.status).toBe('submitted');
  });
});

describe('ведение статуса менеджером', () => {
  it('проходит путь до активной карты, сообщая клиенту каждый шаг', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));

    const processing = await core.updateCardApplicationStatus(manager, application.id, {
      status: 'processing',
      providerReference: 'PRV-42',
    });
    const active = await core.updateCardApplicationStatus(manager, application.id, {
      status: 'active',
    });

    expect(processing.application).toMatchObject({
      status: 'processing',
      providerReference: 'PRV-42',
    });
    expect(processing.notifications).toEqual([
      { kind: 'card-application-status', to: 100n, status: 'processing' },
    ]);
    expect(active.application.status).toBe('active');
    expect(active.notifications).toEqual([
      { kind: 'card-application-status', to: 100n, status: 'active' },
    ]);
  });

  it('не перескакивает через обработку', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));

    await expect(
      core.updateCardApplicationStatus(manager, application.id, { status: 'active' }),
    ).rejects.toThrow(TransitionNotAllowedError);
  });

  it('не трогает закрытую заявку', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));
    await core.updateCardApplicationStatus(manager, application.id, { status: 'rejected' });

    await expect(
      core.updateCardApplicationStatus(manager, application.id, { status: 'processing' }),
    ).rejects.toThrow(TransitionNotAllowedError);
  });

  it('клиенту не даётся: статус ведёт менеджер по ответам провайдера', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));

    await expect(
      core.updateCardApplicationStatus(asClient(100n), application.id, { status: 'active' }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('очередь заявок на карту', () => {
  it('показывает менеджеру незакрытые и убирает закрытые', async () => {
    const { application } = await core.submitCardApplication(asClient(100n));

    expect(await core.listCardApplicationQueue(manager)).toHaveLength(1);

    await core.updateCardApplicationStatus(manager, application.id, { status: 'rejected' });

    expect(await core.listCardApplicationQueue(manager)).toEqual([]);
  });

  it('клиенту показывает только его собственные заявки', async () => {
    await core.registerClient({ telegramUserId: 200n });
    await core.submitCardApplication(asClient(100n));

    expect(await core.listCardApplications(asClient(200n))).toEqual([]);
    expect(await core.listCardApplications(asClient(100n))).toHaveLength(1);
  });
});
