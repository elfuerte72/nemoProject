import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  createCore,
  InvalidInputError,
  NotFoundError,
  type Actor,
} from './index.js';
import { asClient, givenCurrencyPair, givenNetwork, givenStaff } from './test-support.js';

/**
 * Выдача реквизитов для оплаты: менеджер выбирает счёт сервиса — и
 * тогда сообщение клиенту собирает ядро (docs/adr/0008) — или
 * вставляет реквизиты руками (docs/adr/0015).
 *
 * Проверяется здесь то, ради чего справочник остался: счёт не той
 * валюты и погашенный до клиента не доходят, а выданное остаётся в
 * заявке ссылкой — видно, куда клиенту сказали платить. И то, ради
 * чего его перестали требовать: набранное руками уходит клиенту как
 * есть, а не отвергается.
 */

const keys = generateRequisiteKeyPair();
const db = testDatabase();
const core = createCore({
  db,
  requisites: { publicKey: keys.publicKey, privateKey: keys.privateKey },
});

const CARD = '4276 3800 1234 5679';

let manager: Actor & { type: 'staff' };
let admin: Actor & { type: 'staff' };
let requisitesId: string;
/** Куда клиент получает USDT: нужен обратной заявке, в которой он платит рублями. */
let walletRequisitesId: string;

/** Заявка в работе: клиент платит USDT, получает рубли. */
async function givenClaimedRequest(): Promise<string> {
  const { request } = await core.submitExchangeRequest(asClient(100n), {
    kind: 'electronic',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '1000',
    requisitesId,
  });
  await core.claimExchangeRequest(manager, request.id);
  return request.id;
}

/** Счёт сервиса в USDT — им и платит клиент по заявке выше. */
async function givenUsdtAccount(): Promise<string> {
  const account = await core.addServiceAccount(admin, {
    kind: 'wallet',
    currencyCode: 'USDT',
    network: 'TRC20',
    address: 'TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e',
  });
  return account.id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await givenNetwork('TRC20');
  await core.registerClient({ telegramUserId: 100n });
  const requisites = await core.saveRequisites(asClient(100n), {
    kind: 'phone',
    bankName: 'Сбербанк',
    phone: '+79990000000',
  });
  requisitesId = requisites.id;
  const wallet = await core.saveRequisites(asClient(100n), {
    kind: 'wallet',
    network: 'TRC20',
    address: 'TXk8sPzL4nR2vB7cH1dF8gJ5wYt3aU6eQm',
  });
  walletRequisitesId = wallet.id;
  manager = await givenStaff({ displayName: 'Пётр' });
  admin = await givenStaff({ role: 'admin', displayName: 'Владелец' });
});

afterAll(() => closeTestDatabase());

describe('выдача по счёту сервиса', () => {
  it('собирает сообщение клиенту сама — с сетью и полным адресом', async () => {
    const id = await givenClaimedRequest();
    const accountId = await givenUsdtAccount();

    const { request } = await core.confirmExchangeRate(manager, id, {
      finalRate: '95',
      serviceAccountId: accountId,
    });

    expect(request.paymentInstructions).toContain('TRC20');
    expect(request.paymentInstructions).toContain('TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e');
  });

  it('запоминает, какой счёт выдан', async () => {
    const id = await givenClaimedRequest();
    const accountId = await givenUsdtAccount();

    await core.confirmExchangeRate(manager, id, {
      finalRate: '95',
      serviceAccountId: accountId,
    });

    const seen = await core.getExchangeRequestForStaff(manager, id);
    expect(seen.serviceAccountId).toBe(accountId);
  });

  it('называет выданный счёт в истории заявки', async () => {
    const id = await givenClaimedRequest();
    const accountId = await givenUsdtAccount();

    await core.confirmExchangeRate(manager, id, {
      finalRate: '95',
      serviceAccountId: accountId,
    });

    const events = await core.listExchangeRequestEvents(manager, id);
    const issued = events.find((event) => event.toStatus === 'rate_confirmed');
    expect(issued?.comment).toContain('TRC20');
  });

  /*
   * Текст, по которому клиент отправляет деньги, проверяется целиком, а
   * не по одному слову: перевод по номеру телефона уходит наугад без
   * имени получателя — банк показывает его при подтверждении, и
   * клиенту нечего с ним сверить.
   */
  it('называет в переводе по телефону банк, номер и получателя', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '10000',
      requisitesId: walletRequisitesId,
    });
    await core.claimExchangeRequest(manager, request.id);
    const account = await core.addServiceAccount(admin, {
      kind: 'phone',
      currencyCode: 'RUB',
      bankName: 'Сбербанк',
      holderName: 'Иван П.',
      phone: '+7 900 123-45-67',
    });

    const confirmed = await core.confirmExchangeRate(manager, request.id, {
      finalRate: '0.01',
      serviceAccountId: account.id,
    });

    expect(confirmed.request.paymentInstructions).toContain('+7 900 123-45-67');
    expect(confirmed.request.paymentInstructions).toContain('Сбербанк');
    expect(confirmed.request.paymentInstructions).toContain('Иван П.');
  });

  it('называет в переводе на карту полный номер, а не последние цифры', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '10000',
      requisitesId: walletRequisitesId,
    });
    await core.claimExchangeRequest(manager, request.id);
    const account = await core.addServiceAccount(admin, {
      kind: 'card',
      currencyCode: 'RUB',
      bankName: 'Тинькофф',
      holderName: 'Иван П.',
      cardNumber: CARD,
    });

    const confirmed = await core.confirmExchangeRate(manager, request.id, {
      finalRate: '0.01',
      serviceAccountId: account.id,
    });

    expect(confirmed.request.paymentInstructions).toContain(CARD);
    expect(confirmed.request.paymentInstructions).toContain('Тинькофф');
    expect(confirmed.request.paymentInstructions).toContain('Иван П.');
  });

  it('дописывает приписку менеджера к собранному сообщению', async () => {
    const id = await givenClaimedRequest();
    const accountId = await givenUsdtAccount();

    const { request } = await core.confirmExchangeRate(manager, id, {
      finalRate: '95',
      serviceAccountId: accountId,
      paymentInstructions: 'Оплатите одной суммой',
    });

    expect(request.paymentInstructions).toContain('TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e');
    expect(request.paymentInstructions).toContain('Оплатите одной суммой');
  });

  it('не выдаёт счёт не в той валюте, которой платит клиент', async () => {
    const id = await givenClaimedRequest();
    const rubles = await core.addServiceAccount(admin, {
      kind: 'card',
      currencyCode: 'RUB',
      bankName: 'Тинькофф',
      holderName: 'Иван П.',
      cardNumber: CARD,
    });

    await expect(
      core.confirmExchangeRate(manager, id, { finalRate: '95', serviceAccountId: rubles.id }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не выдаёт погашенный счёт', async () => {
    const id = await givenClaimedRequest();
    const accountId = await givenUsdtAccount();
    await core.setServiceAccountActive(admin, accountId, false);

    await expect(
      core.confirmExchangeRate(manager, id, { finalRate: '95', serviceAccountId: accountId }),
    ).rejects.toThrow(InvalidInputError);
  });

  /*
   * Сеть гасят, когда кошелёк в ней временно недоступен, — и выдать по
   * такому счёту значит позвать клиента платить туда, откуда сервис не
   * заберёт. Правило то же, по которому кошелёк в погашенной сети не
   * принимается при подаче заявки.
   */
  it('не выдаёт кошелёк в погашенной сети', async () => {
    const id = await givenClaimedRequest();
    const accountId = await givenUsdtAccount();
    await givenNetwork('TRC20', { isActive: false });

    await expect(
      core.confirmExchangeRate(manager, id, { finalRate: '95', serviceAccountId: accountId }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('незнакомый счёт отвергает', async () => {
    const id = await givenClaimedRequest();

    await expect(
      core.confirmExchangeRate(manager, id, {
        finalRate: '95',
        serviceAccountId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow(NotFoundError);
  });

  /*
   * Погашение счёта — решение о том, куда сервис принимает деньги
   * впредь. Уже выданное остаётся: там записано, куда клиенту сказали
   * платить, и переписывать это задним числом значило бы стереть след.
   */
  it('погашение счёта не трогает уже выданное', async () => {
    const id = await givenClaimedRequest();
    const accountId = await givenUsdtAccount();
    const { request } = await core.confirmExchangeRate(manager, id, {
      finalRate: '95',
      serviceAccountId: accountId,
    });

    await core.setServiceAccountActive(admin, accountId, false);

    const seen = await core.getExchangeRequestForStaff(manager, id);
    expect(seen.paymentInstructions).toBe(request.paymentInstructions);
    expect(seen.serviceAccountId).toBe(accountId);
  });
});

describe('выдача без счёта', () => {
  /*
   * У наличной заявки счёта нет вовсе: клиент приносит деньги на руках,
   * и менеджер называет место и время.
   */
  it('оставляет менеджеру свободный текст', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
    });
    await core.claimExchangeRequest(manager, request.id);

    const confirmed = await core.confirmExchangeRate(manager, request.id, {
      finalRate: '93',
      paymentInstructions: 'Наличными в офисе на Тверской, до 19:00',
    });

    expect(confirmed.request.paymentInstructions).toBe(
      'Наличными в офисе на Тверской, до 19:00',
    );
    expect(confirmed.request.serviceAccountId).toBeNull();
  });

  /*
   * У наличной заявки счёта нет по устройству сделки: деньги приносят
   * на руках. Предложенный счёт означал бы, что менеджер перепутал
   * заявку, — и клиент отправил бы перевод по сделке, которую пришёл
   * закрывать наличными.
   */
  it('счёт по наличной заявке отвергает', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1000',
    });
    await core.claimExchangeRequest(manager, request.id);
    const accountId = await givenUsdtAccount();

    await expect(
      core.confirmExchangeRate(manager, request.id, {
        finalRate: '93',
        serviceAccountId: accountId,
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('пустую выдачу отвергает: клиенту некуда платить', async () => {
    const id = await givenClaimedRequest();

    await expect(
      core.confirmExchangeRate(manager, id, { finalRate: '95' }),
    ).rejects.toThrow(InvalidInputError);
  });

  /*
   * Справочник счетов — подсказка, а не условие (docs/adr/0015). До
   * 5 сентября 2026 безналичная заявка без счёта из справочника
   * отвергалась, и менеджер с кошельком в буфере обмена упирался в
   * пустой раздел настроек. Кошельков и счетов у сервиса много, и
   * меняются они чаще, чем справочник успевают вести.
   */
  it('по безналичной заявке принимает реквизиты, набранные руками', async () => {
    const id = await givenClaimedRequest();

    const { request } = await core.confirmExchangeRate(manager, id, {
      finalRate: '95',
      paymentInstructions: 'TRC20: TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e',
    });

    // Как есть, без обвязки: слова менеджера — это и есть сообщение.
    expect(request.paymentInstructions).toBe('TRC20: TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e');
    expect(request.serviceAccountId).toBeNull();
    expect(request.status).toBe('rate_confirmed');
  });

  it('набранные руками реквизиты уходят клиенту тем же сообщением, что и счёт', async () => {
    const id = await givenClaimedRequest();

    const { notifications } = await core.confirmExchangeRate(manager, id, {
      finalRate: '95',
      paymentInstructions: 'Карта 2200 7005 3456 7890, Т-Банк, Иван П.',
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        status: 'rate_confirmed',
        paymentInstructions: 'Карта 2200 7005 3456 7890, Т-Банк, Иван П.',
      }),
    ]);
  });

  /*
   * Без счёта в истории заявки нет и строки о выданном счёте: подпись
   * «Выдан счёт: …» обещала бы ссылку на справочник, которой нет.
   */
  it('без счёта история заявки счёт не называет', async () => {
    const id = await givenClaimedRequest();

    await core.confirmExchangeRate(manager, id, {
      finalRate: '95',
      paymentInstructions: 'TRC20: TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e',
    });

    const events = await core.listExchangeRequestEvents(manager, id);
    const issued = events.find((event) => event.toStatus === 'rate_confirmed');
    expect(issued?.comment ?? null).toBeNull();
  });
});
