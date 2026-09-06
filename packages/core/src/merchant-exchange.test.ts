import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { bonusTransactions } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenMerchant,
  givenNetwork,
  givenStaff,
} from './test-support.js';

/**
 * Заявка мерчанта — та же заявка, что у клиента, и правила у неё те же
 * (docs/adr/0017). Проверяется здесь ровно то, чем она отличается: кто
 * владелец, что приходит в теле запроса и чего у неё не бывает.
 */

const db = testDatabase();
const keys = generateRequisiteKeyPair();
const core = createCore({ db, requisites: { publicKey: keys.publicKey } });

let merchant: Actor & { type: 'merchant' };

/** Реквизиты покупателя мерчанта — то, что приходит в теле запроса. */
const PAYOUT = {
  kind: 'card',
  bankName: 'Сбербанк',
  cardNumber: '4111111111111111',
} as const;

beforeEach(async () => {
  await resetDatabase(db);
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenNetwork('TRC20');
  merchant = await givenMerchant({ email: 'shop@example.com' });
});

afterAll(() => closeTestDatabase());

describe('подача заявки мерчантом', () => {
  it('заводит заявку с владельцем-мерчантом и его внешним номером', async () => {
    const { request } = await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
      reference: 'booking-1024',
      idempotencyKey: 'booking-1024',
    });

    expect(request.owner).toEqual({ kind: 'merchant', merchantId: merchant.merchantId });
    expect(request.reference).toBe('booking-1024');
  });

  /**
   * Сеть рвётся посреди ответа, и мерчант, не получивший его, повторяет
   * запрос. Без ключа он оплатил бы обмен дважды.
   */
  it('повтор с тем же ключом отдаёт ту же заявку, а не вторую', async () => {
    const input = {
      kind: 'electronic' as const,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
      idempotencyKey: 'booking-1024',
    };

    const first = await core.submitExchangeRequest(merchant, input);
    const second = await core.submitExchangeRequest(merchant, input);

    expect(second.request.id).toBe(first.request.id);
    expect(await core.listExchangeRequests(merchant)).toHaveLength(1);
    // Повтор — не событие: письмо о новой заявке уходит однажды.
    expect(second.notifications).toEqual([]);
  });

  it('тот же ключ у другого мерчанта заводит свою заявку', async () => {
    const other = await givenMerchant({ email: 'other@example.com', name: 'Другой' });
    const input = {
      kind: 'electronic' as const,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
      idempotencyKey: 'booking-1024',
    };

    const mine = await core.submitExchangeRequest(merchant, input);
    const theirs = await core.submitExchangeRequest(other, input);

    expect(theirs.request.id).not.toBe(mine.request.id);
  });

  /**
   * Правдоподобие проверяется теми же правилами, что у формы: путь
   * через API не должен быть слабее — перевод по опечатке не
   * возвращается.
   */
  it('неправдоподобную карту отвергает теми же словами, что форму', async () => {
    await expect(
      core.submitExchangeRequest(merchant, {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        payout: { ...PAYOUT, cardNumber: '4111111111111112' },
      }),
    ).rejects.toThrow(/контрольной цифре/);
  });

  /**
   * Список получателей не должен расти на каждую заявку: у покупателя
   * мерчанта сохранённых записей нет и не будет.
   */
  it('получатель из тела в список сохранённых не попадает', async () => {
    await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
    });

    expect(await core.listRequisites(merchant)).toEqual([]);
  });

  it('своими сохранёнными реквизитами тоже подаёт', async () => {
    const saved = await core.saveRequisites(merchant, {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });

    const { request } = await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId: saved.id,
    });

    expect(request.requisitesId).toBe(saved.id);
    expect(await core.listRequisites(merchant)).toHaveLength(1);
  });

  it('два получателя разом не принимает', async () => {
    const saved = await core.saveRequisites(merchant, {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });

    await expect(
      core.submitExchangeRequest(merchant, {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        requisitesId: saved.id,
        payout: PAYOUT,
      }),
    ).rejects.toThrow(/либо/i);
  });

  /** Встреча и касса программно не автоматизируются. */
  it('наличную заявку не принимает', async () => {
    await expect(
      core.submitExchangeRequest(merchant, {
        kind: 'cash',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
      }),
    ).rejects.toThrow(/наличн/i);
  });

  it('ключ отключённого мерчанта заявок не заводит', async () => {
    const off = await givenMerchant({ email: 'off@example.com', status: 'disabled' });

    await expect(
      core.submitExchangeRequest(off, {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        payout: PAYOUT,
      }),
    ).rejects.toThrow(/поддержк/i);
  });

  it('неодобренный мерчант заявок не заводит', async () => {
    const pending = await givenMerchant({ email: 'new@example.com', status: 'pending' });

    await expect(
      core.submitExchangeRequest(pending, {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        payout: PAYOUT,
      }),
    ).rejects.toThrow(/рассмотрени/i);
  });

  /** Внешнего номера и ключа повтора у клиента взяться неоткуда. */
  it('клиенту внешний номер не принимает', async () => {
    await core.registerClient({ telegramUserId: 100n });
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });

    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        requisitesId: saved.id,
        reference: 'booking-1024',
      }),
    ).rejects.toThrow(/мерчант/i);
  });
});

describe('своё и чужое', () => {
  async function requestOf(actor: Actor): Promise<string> {
    const { request } = await core.submitExchangeRequest(actor, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
    });
    return request.id;
  }

  it('чужую заявку мерчант не видит и не отменяет', async () => {
    const other = await givenMerchant({ email: 'other@example.com', name: 'Другой' });
    const theirs = await requestOf(other);

    await expect(core.getExchangeRequest(merchant, theirs)).rejects.toThrow(/не найдена/i);
    await expect(core.cancelOwnExchangeRequest(merchant, theirs)).rejects.toThrow(
      /не найдена/i,
    );
    expect(await core.listExchangeRequests(merchant)).toEqual([]);
  });

  it('заявку клиента мерчант не видит', async () => {
    await core.registerClient({ telegramUserId: 100n });
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId: saved.id,
    });

    await expect(core.getExchangeRequest(merchant, request.id)).rejects.toThrow(
      /не найдена/i,
    );
  });

  it('чужие сохранённые реквизиты в списке не показываются', async () => {
    await core.registerClient({ telegramUserId: 100n });
    await core.saveRequisites(asClient(100n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });

    expect(await core.listRequisites(merchant)).toEqual([]);
  });

  /**
   * Лента своей заявки — без имён сотрудников: мерчанту незачем знать,
   * кто из смены вёл его обмен.
   */
  it('лента своей заявки не называет сотрудников', async () => {
    const manager = await givenStaff();
    const requestId = await requestOf(merchant);
    await core.claimExchangeRequest(manager, requestId);

    const events = await core.listExchangeRequestEventsForOwner(merchant, requestId);
    expect(events.map((one) => one.toStatus)).toEqual(['new', 'in_progress']);
    expect(JSON.stringify(events)).not.toContain(manager.staffId);
  });

  it('лента чужой заявки не отдаётся вовсе', async () => {
    const other = await givenMerchant({ email: 'other@example.com' });
    const theirs = await requestOf(other);

    await expect(
      core.listExchangeRequestEventsForOwner(merchant, theirs),
    ).rejects.toThrow(/не найдена/i);
  });
});

describe('клиентское мерчанту не отдаётся', () => {
  it('баллы, выводы, карта и переписка отказывают', async () => {
    await expect(core.getBonusAccount(merchant)).rejects.toThrow(/клиент/i);
    await expect(
      core.submitWithdrawalRequest(merchant, { amount: '1000', requisitesId: 'x' }),
    ).rejects.toThrow(/клиент/i);
    await expect(core.submitCardApplication(merchant)).rejects.toThrow(/клиент/i);
    await expect(core.getClientHistory(merchant)).rejects.toThrow(/клиент/i);
  });
});

describe('исполнение заявки мерчанта', () => {
  /**
   * Реферера у мерчанта нет: рефералка — клиентская механика, а
   * отношения мерчанта с сервисом описаны договором.
   */
  it('не начисляет реферальных баллов', async () => {
    const manager = await givenStaff();
    const { request } = await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
    });

    await core.claimExchangeRequest(manager, request.id);
    await core.confirmExchangeRate(manager, request.id, {
      finalRate: '80',
      paymentInstructions: 'Кошелёк TRC20',
    });
    await core.markPaymentReceived(manager, request.id);
    const completed = await core.completeExchangeRequest(manager, request.id, {
      serviceIncome: '5',
      serviceIncomeCode: 'USDT',
    });

    expect(completed.request.status).toBe('completed');
    expect(await db.select().from(bonusTransactions)).toEqual([]);
  });

  /**
   * Отключение закрывает подачу, а не работу: деньги по открытой заявке
   * мерчант уже отправил, и бросать её на полпути значило бы наказать
   * его за решение администратора.
   */
  it('открытая заявка отключённого мерчанта доходит до конца', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const manager = await givenStaff();
    const { request } = await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
    });

    await core.setMerchantActive(admin, merchant.merchantId, false);

    // Новых заявок больше нет...
    await expect(
      core.submitExchangeRequest(merchant, {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        payout: PAYOUT,
      }),
    ).rejects.toThrow(/поддержк/i);

    // ...а начатая доходит до исполнения.
    await core.claimExchangeRequest(manager, request.id);
    await core.confirmExchangeRate(manager, request.id, {
      finalRate: '80',
      paymentInstructions: 'Кошелёк TRC20',
    });
    await core.markPaymentReceived(manager, request.id);
    const done = await core.completeExchangeRequest(manager, request.id, {
      serviceIncome: '5',
      serviceIncomeCode: 'USDT',
    });
    expect(done.request.status).toBe('completed');

    // И видит её мерчант по-прежнему: вход в кабинет отключение не
    // закрывает — иначе он не узнал бы, чем всё кончилось.
    expect(await core.listExchangeRequests(merchant)).toHaveLength(1);
  });

  /** Письма о переходах уходят на почту мерчанта, а не в Telegram. */
  it('шлёт уведомления на почту мерчанта', async () => {
    const manager = await givenStaff();
    const { request, notifications } = await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
    });

    expect(notifications[0]?.to).toEqual({
      kind: 'merchant',
      merchantId: merchant.merchantId,
      email: 'shop@example.com',
    });

    const claimed = await core.claimExchangeRequest(manager, request.id);
    expect(claimed.notifications[0]?.to).toMatchObject({ kind: 'merchant' });
  });
});

describe('журнал доступа к реквизитам', () => {
  /**
   * Реквизиты покупателя мерчанта — такой же чужой номер карты, и след
   * от его чтения нужен по той же причине.
   */
  it('помнит, что открывали реквизиты мерчанта', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const manager = await givenStaff({ displayName: 'Пётр' });
    const withKeys = createCore({ db, requisites: keys });
    const { request } = await withKeys.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
    });
    await withKeys.claimExchangeRequest(manager, request.id);

    const revealed = await withKeys.revealRequisites(manager, request.id);
    expect(revealed.cardNumber).toBe('4111111111111111');

    expect(await withKeys.listRequisiteAccessLog(admin)).toEqual([
      expect.objectContaining({
        staffId: manager.staffId,
        owner: { kind: 'merchant', merchantId: merchant.merchantId },
        exchangeRequestId: request.id,
      }),
    ]);
  });
});

describe('чистка после мерчанта', () => {
  /** Мерчанта не удаляют: на него ссылаются заявки. */
  it('удаление мерчанта с заявкой отвергается базой', async () => {
    await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
    });

    const { merchants } = await import('@nemo/db');
    await expect(
      db.delete(merchants).where(eq(merchants.id, merchant.merchantId)),
    ).rejects.toThrow();
  });
});
