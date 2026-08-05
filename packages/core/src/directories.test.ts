import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, NotFoundError } from './index.js';
import { givenCurrencyPair, givenNetwork, givenStaff } from './test-support.js';

/**
 * Справочники сервиса: сети перевода и направления обмена.
 *
 * Сети — одна правда на весь сервис: реквизиты обмена и заявки на вывод
 * берут их из одного места, и выключенная сеть закрывается сразу для
 * обоих. Заготовки — наоборот, живут и пустыми: сервис, у которого
 * администратор ещё не заходил в настройки, обязан работать.
 */

const keys = generateRequisiteKeyPair();
const core = createCore({
  db: testDatabase(),
  requisites: { publicKey: keys.publicKey },
});

beforeEach(() => resetDatabase());

afterAll(() => closeTestDatabase());

describe('справочник сетей', () => {
  it('отдаёт клиенту только включённые сети', async () => {
    await givenNetwork('TRC20');
    await givenNetwork('TON', { isActive: false });

    expect(await core.listActiveNetworks()).toEqual(['TRC20']);
  });

  it('гасится администратором и сразу перестаёт предлагаться', async () => {
    await givenNetwork('TRC20');
    const admin = await givenStaff({ role: 'admin' });

    await core.setNetworkActive(admin, 'TRC20', false);

    expect(await core.listActiveNetworks()).toEqual([]);
  });

  it('менеджеру не подчиняется: справочник — работа администратора', async () => {
    await givenNetwork('TRC20');
    const manager = await givenStaff({ role: 'manager' });

    await expect(core.setNetworkActive(manager, 'TRC20', false)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('оставляет след в журнале настроек', async () => {
    await givenNetwork('TRC20');
    const admin = await givenStaff({ role: 'admin' });

    await core.setNetworkActive(admin, 'TRC20', false);

    const log = await core.listSettingsAuditLog(admin);
    expect(log[0]?.subject).toBe('transfer_network');
    expect(log[0]?.subjectId).toBe('TRC20');
  });

  it('не гасит сеть, которой в нём нет', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(core.setNetworkActive(admin, 'ERC20', false)).rejects.toThrow(NotFoundError);
  });
});

/**
 * Направления администратор не заводит — их состав задаёт скрипт
 * развёртывания. Но гасит: курс безналичной заявки фиксируется при
 * подаче, и направление, на котором цена разошлась с рынком, надо уметь
 * закрыть за секунды.
 */
describe('справочник направлений', () => {
  it('отдаёт администратору и включённые, и погашенные', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB' });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'THB', isActive: false });
    const admin = await givenStaff({ role: 'admin' });

    const directions = await core.listDirections(admin);

    expect(directions.map((one) => [one.toCode, one.isActive])).toEqual([
      ['RUB', true],
      ['THB', false],
    ]);
  });

  it('гасится администратором и сразу перестаёт предлагаться клиенту', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB' });
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'THB' });
    const admin = await givenStaff({ role: 'admin' });
    const baht = (await core.listDirections(admin)).find((one) => one.toCode === 'THB');

    await core.setDirectionActive(admin, baht!.id, false);

    const terms = await core.getExchangeTerms();
    expect(terms.pairs.map((pair) => pair.toCode)).toEqual(['RUB']);
  });

  it('менеджеру не подчиняется: цена направления — работа администратора', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'THB' });
    const admin = await givenStaff({ role: 'admin' });
    const manager = await givenStaff({ role: 'manager' });
    const [direction] = await core.listDirections(admin);

    await expect(core.setDirectionActive(manager, direction!.id, false)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('оставляет след в журнале настроек', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'THB' });
    const admin = await givenStaff({ role: 'admin' });
    const [direction] = await core.listDirections(admin);

    await core.setDirectionActive(admin, direction!.id, false);

    const log = await core.listSettingsAuditLog(admin);
    expect(log[0]?.subject).toBe('currency_pair');
    expect(log[0]?.changes).toMatchObject({ action: 'disabled', direction: 'USDT → THB' });
  });

  it('не гасит направление, которого в нём нет', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(
      core.setDirectionActive(admin, '00000000-0000-0000-0000-000000000000', false),
    ).rejects.toThrow(NotFoundError);
  });
});
