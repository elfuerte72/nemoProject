import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { serviceAccounts } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, InvalidInputError, NotFoundError } from './index.js';
import { givenCurrency, givenNetwork, givenStaff } from './test-support.js';

/**
 * Счета сервиса — куда клиент отправляет оплату (docs/adr/0008).
 *
 * Проверяется то же, что у реквизитов клиента: неполной записи не
 * существует, открытого номера в базе нет, — и сверх того права.
 * Заводит счета администратор, выбирает из готового менеджер: счёт —
 * решение о том, куда сервис принимает деньги, а не шаг по заявке.
 */

const keys = generateRequisiteKeyPair();
const db = testDatabase();
const core = createCore({
  db,
  requisites: { publicKey: keys.publicKey, privateKey: keys.privateKey },
});

/** Номер сходится по контрольной цифре: иначе его отвергнет сама операция. */
const CARD = '4276 3800 1234 5679';
const ADDRESS = 'TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e';

beforeEach(async () => {
  await resetDatabase();
  await givenCurrency('RUB');
  await givenCurrency('USDT');
  await givenNetwork('TRC20');
});

afterAll(() => closeTestDatabase());

describe('заведение счёта', () => {
  it('не оставляет открытого номера карты в базе', async () => {
    const admin = await givenStaff({ role: 'admin' });

    const account = await core.addServiceAccount(admin, {
      kind: 'card',
      currencyCode: 'RUB',
      bankName: 'Тинькофф',
      holderName: 'Иван П.',
      cardNumber: CARD,
    });

    expect(account.cardLast4).toBe('5679');
    expect(JSON.stringify(account)).not.toContain('4276');

    const [row] = await db.select().from(serviceAccounts);
    expect(row!.cardSealed).toBeInstanceOf(Buffer);
    expect(row!.cardSealed!.toString('utf8')).not.toContain('4276');
  });

  it('отвергает номер, не сходящийся по контрольной цифре', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(
      core.addServiceAccount(admin, {
        kind: 'card',
        currencyCode: 'RUB',
        bankName: 'Тинькофф',
        holderName: 'Иван П.',
        cardNumber: '4276 3800 1234 5678',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает адрес не той формы, что у сети', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(
      core.addServiceAccount(admin, {
        kind: 'wallet',
        currencyCode: 'USDT',
        network: 'TRC20',
        address: 'не адрес',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не заводится без получателя у перевода по телефону', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(
      core.addServiceAccount(admin, {
        kind: 'phone',
        currencyCode: 'RUB',
        bankName: 'Сбербанк',
        holderName: '   ',
        phone: '+7 900 123-45-67',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает валюту, которой нет в справочнике', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(
      core.addServiceAccount(admin, {
        kind: 'phone',
        currencyCode: 'THB',
        bankName: 'Сбербанк',
        holderName: 'Иван П.',
        phone: '+7 900 123-45-67',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  /*
   * Способ должен подходить валюте — тем же правилом, по которому
   * подбирается реквизит клиента: рубли приходят на карту и по
   * телефону, USDT на кошелёк. Карта в USDT — счёт, на который клиент
   * не отправит, и обнаружилось бы это на живой заявке.
   */
  it('не заводит карту в криптовалюте', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(
      core.addServiceAccount(admin, {
        kind: 'card',
        currencyCode: 'USDT',
        bankName: 'Тинькофф',
        holderName: 'Иван П.',
        cardNumber: CARD,
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не заводит кошелёк в фиате', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(
      core.addServiceAccount(admin, {
        kind: 'wallet',
        currencyCode: 'RUB',
        network: 'TRC20',
        address: ADDRESS,
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('менеджеру недоступно', async () => {
    const manager = await givenStaff({ role: 'manager' });

    await expect(
      core.addServiceAccount(manager, {
        kind: 'phone',
        currencyCode: 'RUB',
        bankName: 'Сбербанк',
        holderName: 'Иван П.',
        phone: '+7 900 123-45-67',
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('список счетов', () => {
  it('менеджер видит счета, но не их номера', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const manager = await givenStaff({ role: 'manager' });
    await core.addServiceAccount(admin, {
      kind: 'card',
      currencyCode: 'RUB',
      bankName: 'Тинькофф',
      holderName: 'Иван П.',
      cardNumber: CARD,
    });

    const list = await core.listServiceAccounts(manager);

    expect(list).toHaveLength(1);
    expect(list[0]!.cardLast4).toBe('5679');
    expect(JSON.stringify(list)).not.toContain('4276');
  });

  it('погашенный счёт остаётся в списке помеченным', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const account = await core.addServiceAccount(admin, {
      kind: 'wallet',
      currencyCode: 'USDT',
      network: 'TRC20',
      address: ADDRESS,
    });

    await core.setServiceAccountActive(admin, account.id, false);

    const list = await core.listServiceAccounts(admin);
    expect(list).toHaveLength(1);
    expect(list[0]!.isActive).toBe(false);
  });
});

describe('правка счёта', () => {
  it('меняет номер, не оставляя следа прежнего', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const account = await core.addServiceAccount(admin, {
      kind: 'card',
      currencyCode: 'RUB',
      bankName: 'Тинькофф',
      holderName: 'Иван П.',
      cardNumber: CARD,
    });

    const updated = await core.updateServiceAccount(admin, account.id, {
      kind: 'card',
      currencyCode: 'RUB',
      bankName: 'Сбербанк',
      holderName: 'Пётр С.',
      cardNumber: '5536 9138 1234 5672',
    });

    expect(updated.bankName).toBe('Сбербанк');
    expect(updated.cardLast4).toBe('5672');
  });

  /*
   * Смена способа переписывает поля целиком: у кошелька не бывает
   * банка, и оставленное от прежнего способа поле — это запись, по
   * которой отправят не туда.
   */
  it('при смене способа не оставляет полей прежнего', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const account = await core.addServiceAccount(admin, {
      kind: 'card',
      currencyCode: 'RUB',
      bankName: 'Тинькофф',
      holderName: 'Иван П.',
      cardNumber: CARD,
    });

    const updated = await core.updateServiceAccount(admin, account.id, {
      kind: 'wallet',
      currencyCode: 'USDT',
      network: 'TRC20',
      address: ADDRESS,
    });

    expect(updated.kind).toBe('wallet');
    expect(updated.bankName).toBeNull();
    expect(updated.cardLast4).toBeNull();
  });

  it('незнакомый счёт не правится', async () => {
    const admin = await givenStaff({ role: 'admin' });

    await expect(
      core.updateServiceAccount(admin, '00000000-0000-0000-0000-000000000000', {
        kind: 'phone',
        currencyCode: 'RUB',
        bankName: 'Сбербанк',
        holderName: 'Иван П.',
        phone: '+7 900 123-45-67',
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('менеджеру недоступна — ни правка, ни гашение', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const manager = await givenStaff({ role: 'manager' });
    const account = await core.addServiceAccount(admin, {
      kind: 'phone',
      currencyCode: 'RUB',
      bankName: 'Сбербанк',
      holderName: 'Иван П.',
      phone: '+7 900 123-45-67',
    });

    await expect(
      core.updateServiceAccount(manager, account.id, {
        kind: 'phone',
        currencyCode: 'RUB',
        bankName: 'Тинькофф',
        holderName: 'Пётр С.',
        phone: '+7 900 765-43-21',
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(core.setServiceAccountActive(manager, account.id, false)).rejects.toThrow(
      ForbiddenError,
    );
  });
});
