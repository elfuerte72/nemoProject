import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, InvalidInputError, NotFoundError } from './index.js';
import { givenNetwork, givenStaff } from './test-support.js';

/**
 * Справочники сервиса: сети перевода и заготовки текстов.
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

describe('заготовки текстов', () => {
  it('берутся из кода, пока справочник пуст', async () => {
    const manager = await givenStaff({ role: 'manager' });

    const templates = await core.listTextTemplates(manager);

    expect(templates).not.toHaveLength(0);
    expect(templates.every((one) => one.isDefault)).toBe(true);
    expect(templates.every((one) => one.body.length > 0)).toBe(true);
  });

  it('берутся из справочника, когда администратор их задал', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await core.updateTextTemplate(admin, 'payment_requisites_rub', 'Карта 1234, Иван И.');

    const templates = await core.listTextTemplates(admin);
    const stored = templates.find((one) => one.key === 'payment_requisites_rub');
    expect(stored?.body).toBe('Карта 1234, Иван И.');
    expect(stored?.isDefault).toBe(false);
  });

  it('видны менеджеру: вставлять заготовку в заявку — его работа', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const manager = await givenStaff({ role: 'manager' });
    await core.updateTextTemplate(admin, 'payment_requisites_usdt', 'Кошелёк TRC20: TQm…');

    const templates = await core.listTextTemplates(manager);

    expect(templates.find((one) => one.key === 'payment_requisites_usdt')?.body).toBe(
      'Кошелёк TRC20: TQm…',
    );
  });

  it('правятся только администратором', async () => {
    const manager = await givenStaff({ role: 'manager' });

    await expect(
      core.updateTextTemplate(manager, 'payment_requisites_rub', 'Что угодно'),
    ).rejects.toThrow(ForbiddenError);
  });

  it('не сбрасываются пустым текстом', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(
      core.updateTextTemplate(admin, 'payment_requisites_rub', '   '),
    ).rejects.toThrow(InvalidInputError);
  });

  it('оставляют след в журнале настроек', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await core.updateTextTemplate(admin, 'payment_requisites_rub', 'Карта 1234, Иван И.');

    const log = await core.listSettingsAuditLog(admin);
    expect(log[0]?.subject).toBe('text_template');
    expect(log[0]?.subjectId).toBe('payment_requisites_rub');
  });
});
