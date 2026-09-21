import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { bonusTransactions, clientRequisites, exchangeRequests } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenMerchant,
  givenNetwork,
  givenServiceSettings,
  givenStaff,
} from './test-support.js';

/**
 * Заявка мерчанта — та же заявка, что у клиента, и правила у неё те же
 * (docs/adr/0017). Проверяется здесь ровно то, чем она отличается: кто
 * владелец, что приходит в теле запроса и чего у неё не бывает.
 */

const db = testDatabase();
const keys = generateRequisiteKeyPair();
// Префикс ключей нужен подаче по API: ею заводится ключ в сцене.
const core = createCore({ db, requisites: { publicKey: keys.publicKey }, apiKeyPrefix: 'sk_test_' });

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

  /**
   * Пустой ключ — это отсутствие ключа, а не ключ «пусто». Обвязка
   * мерчанта, шлющая заголовок пустым, иначе получала бы на каждую
   * новую заявку первую: заявки перестают подаваться, и молча.
   */
  it('пустой ключ повтора заявки не склеивает', async () => {
    const first = await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
      idempotencyKey: '  ',
    });
    const second = await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '999',
      payout: PAYOUT,
      idempotencyKey: '',
    });

    expect(second.request.id).not.toBe(first.request.id);
    expect(second.request.fromAmount).toBe('999');
    expect(second.request.reference).toBeNull();
  });

  /**
   * Ключ и заведён ради этого случая: мерчант не дождался ответа и
   * повторил запрос, пока первый ещё в полёте. Обе подачи доходят до
   * вставки, и вторая обязана отдать ту же заявку, а не пятисотый —
   * иначе он повторит ещё раз, и ещё.
   */
  it('повтор, пришедший, пока первый в полёте, отдаёт ту же заявку', async () => {
    const input = {
      kind: 'electronic' as const,
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
      idempotencyKey: 'booking-1024',
    };

    const [one, two] = await Promise.all([
      core.submitExchangeRequest(merchant, input),
      core.submitExchangeRequest(merchant, input),
    ]);

    expect(two.request.id).toBe(one.request.id);
    expect(await core.listExchangeRequests(merchant)).toHaveLength(1);
  });

  /**
   * Отказ не должен оставлять следов: запись получателя шифруется и
   * заводится в той же транзакции, что и заявка, — иначе каждая
   * отвергнутая подача копит в базе строку, на которую никто не
   * сошлётся.
   */
  it('отвергнутая подача не оставляет записи получателя', async () => {
    await givenServiceSettings({ minExchangeAmount: '1000000' });

    await expect(
      core.submitExchangeRequest(merchant, {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '1',
        payout: PAYOUT,
      }),
    ).rejects.toThrow(/Минимальная сумма/);

    expect(await db.select().from(clientRequisites)).toEqual([]);
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

/**
 * Счётчик заявок. Числа за табами кабинета считает база, а не длина
 * показанной страницы: страница ограничена пределом, и «50» означало бы
 * и пятьдесят, и пятьсот.
 */
describe('счёт своих заявок', () => {
  async function submit(actor: Actor): Promise<string> {
    const { request } = await core.submitExchangeRequest(actor, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
    });
    return request.id;
  }

  it('считает свои и не считает чужие', async () => {
    await submit(merchant);
    await submit(merchant);
    const other = await givenMerchant({ email: 'other@example.com', name: 'Другой' });
    await submit(other);

    expect(await core.countExchangeRequests(merchant)).toBe(2);
    expect(await core.countExchangeRequests(other)).toBe(1);
  });

  it('раскладывает по состояниям одним запросом', async () => {
    const first = await submit(merchant);
    await submit(merchant);
    await core.cancelOwnExchangeRequest(merchant, first);

    expect(await core.countExchangeRequestsByStatus(merchant)).toEqual({
      new: 1,
      in_progress: 0,
      rate_confirmed: 0,
      payment_received: 0,
      completed: 0,
      cancelled: 1,
    });
  });

  it('считает по состоянию и по нескольким разом', async () => {
    const first = await submit(merchant);
    await submit(merchant);
    await core.cancelOwnExchangeRequest(merchant, first);

    expect(await core.countExchangeRequests(merchant, { status: 'cancelled' })).toBe(1);
    expect(await core.countExchangeRequests(merchant, { status: 'new' })).toBe(1);
    expect(
      await core.countExchangeRequests(merchant, { statuses: ['new', 'in_progress'] }),
    ).toBe(1);
  });
});

/**
 * Свой список мерчант читает сотнями и продолжает курсором по паре
 * «время подачи и идентификатор». До 7 сентября 2026 условие курсора
 * сравнивало кортеж сырым `sql`, и драйвер отправлял дату строкой —
 * вторая страница отвечала пятисотым, а первая скрывала это.
 */
describe('курсор своего списка', () => {
  it('дочитывает без потерь и дублей, даже когда время подачи одно', async () => {
    for (let i = 0; i < 5; i += 1) {
      await core.submitExchangeRequest(merchant, {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: String(100 + i),
        payout: PAYOUT,
      });
    }
    // Пять заявок в одну миллисекунду — так подают по API пачкой.
    const at = new Date('2026-09-07T10:00:00Z');
    await db.update(exchangeRequests).set({ createdAt: at });

    const seen: string[] = [];
    let after: { createdAt: Date; id: string } | undefined;
    for (let page = 0; page < 4; page += 1) {
      const rows = await core.listExchangeRequests(merchant, {
        limit: 2,
        ...(after ? { after } : {}),
      });
      if (rows.length === 0) break;
      seen.push(...rows.map((row) => row.id));
      const last = rows[rows.length - 1]!;
      after = { createdAt: last.createdAt, id: last.id };
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});

/**
 * Поиск по своему номеру — главный путь в список: покупатель пишет
 * мерчанту «заказ 1013, где деньги», и тот идёт искать заявку по
 * номеру, который знает его система. Нашего идентификатора он не видел
 * нигде, кроме письма и вебхука, — оттуда его копируют целиком.
 *
 * Проверяется тестом, потому что ломается тихо: база собрана с локалью
 * `C`, и обычный `ilike` кириллицу по регистру не сводит — «Бронь» на
 * запрос «бронь» не находится, а латинские номера при этом ищутся, и
 * на глаз поиск выглядит рабочим.
 */
describe('поиск своей заявки', () => {
  async function submit(actor: Actor, reference?: string): Promise<string> {
    const { request } = await core.submitExchangeRequest(actor, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
      ...(reference === undefined ? {} : { reference }),
    });
    return request.id;
  }

  it('находит по куску своего номера', async () => {
    const wanted = await submit(merchant, 'order-1013');
    await submit(merchant, 'order-2044');

    const rows = await core.listExchangeRequests(merchant, { search: '1013' });
    expect(rows.map((row) => row.id)).toEqual([wanted]);
  });

  it('кириллицу находит в любом регистре', async () => {
    const wanted = await submit(merchant, 'Бронь №1024');

    const rows = await core.listExchangeRequests(merchant, { search: 'бронь' });
    expect(rows.map((row) => row.id)).toEqual([wanted]);
  });

  it('наш идентификатор целиком тоже находит заявку', async () => {
    const wanted = await submit(merchant, 'order-1');
    await submit(merchant, 'order-2');

    const rows = await core.listExchangeRequests(merchant, { search: wanted });
    expect(rows.map((row) => row.id)).toEqual([wanted]);
    // И с пробелами по краям: копируют из письма вместе с ними.
    const padded = await core.listExchangeRequests(merchant, { search: `  ${wanted} ` });
    expect(padded.map((row) => row.id)).toEqual([wanted]);
  });

  it('чужую заявку не находит ни по номеру, ни по идентификатору', async () => {
    const other = await givenMerchant({ email: 'other@example.com', name: 'Другой' });
    const theirs = await submit(other, 'order-1013');

    expect(await core.listExchangeRequests(merchant, { search: '1013' })).toEqual([]);
    expect(await core.listExchangeRequests(merchant, { search: theirs })).toEqual([]);
  });

  it('знаки шаблона ищет буквально, а не как «что угодно»', async () => {
    await submit(merchant, 'order-1013');
    const wanted = await submit(merchant, 'скидка 100%');

    const rows = await core.listExchangeRequests(merchant, { search: '100%' });
    expect(rows.map((row) => row.id)).toEqual([wanted]);
    expect(await core.listExchangeRequests(merchant, { search: '_' })).toEqual([]);
  });

  it('пустой запрос — это отсутствие поиска, а не пустой ответ', async () => {
    await submit(merchant, 'order-1');
    await submit(merchant);

    expect(await core.listExchangeRequests(merchant, { search: '   ' })).toHaveLength(2);
  });

  it('счёт и раскладка по состояниям считают найденное, а не всё', async () => {
    const cancelled = await submit(merchant, 'order-1013');
    await submit(merchant, 'order-1014');
    await submit(merchant, 'booking-7');
    await core.cancelOwnExchangeRequest(merchant, cancelled);

    expect(await core.countExchangeRequests(merchant, { search: 'order' })).toBe(2);
    expect(await core.countExchangeRequestsByStatus(merchant, { search: 'order' })).toEqual({
      new: 1,
      in_progress: 0,
      rate_confirmed: 0,
      payment_received: 0,
      completed: 0,
      cancelled: 1,
    });
    // Без поиска раскладка прежняя — по всем заявкам.
    expect((await core.countExchangeRequestsByStatus(merchant)).new).toBe(2);
  });

  it('курсор с поиском дочитывает без потерь и дублей', async () => {
    for (let i = 0; i < 5; i += 1) await submit(merchant, `order-${i}`);
    await submit(merchant, 'booking-9');
    const at = new Date('2026-09-07T10:00:00Z');
    await db.update(exchangeRequests).set({ createdAt: at });

    const seen: string[] = [];
    let after: { createdAt: Date; id: string } | undefined;
    for (let page = 0; page < 4; page += 1) {
      const rows = await core.listExchangeRequests(merchant, {
        search: 'order',
        limit: 2,
        ...(after ? { after } : {}),
      });
      if (rows.length === 0) break;
      seen.push(...rows.map((row) => row.id));
      const last = rows[rows.length - 1]!;
      after = { createdAt: last.createdAt, id: last.id };
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});

/**
 * Источник заявки доезжает до ответа о ней. Он писался при подаче и
 * читался только разрезами аналитики, а карточке заявки нечем было
 * сказать, откуда заявка взялась. У поданной без отметки он пуст, и
 * пустота так и отдаётся: угаданный источник читался бы как записанный.
 */
describe('источник заявки', () => {
  const body = {
    kind: 'electronic',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100',
    payout: PAYOUT,
  } as const;

  it('названный при подаче — отдаётся и в ответе подачи, и в списке, и по номеру', async () => {
    const { request } = await core.submitExchangeRequest(merchant, { ...body, source: 'api' });
    expect(request.source).toBe('api');

    const [listed] = await core.listExchangeRequests(merchant);
    expect(listed?.source).toBe('api');
    expect((await core.getExchangeRequest(merchant, request.id)).source).toBe('api');
  });

  it('не названный — пуст, а не угадан', async () => {
    const { request } = await core.submitExchangeRequest(merchant, body);
    expect(request.source).toBeNull();
  });
});

/**
 * Куда ушли деньги по заявке — первый вопрос при жалобе покупателя:
 * мерчант сверяет карту из своей системы с той, на которую отправил
 * сервис. Прочитать запись ему было нечем: поданная по API запись
 * архивируется сразу, а список получателей отдаёт только неархивные, —
 * то есть у заявок интеграции запись была всегда и не была видна
 * никогда.
 */
describe('получатель заявки', () => {
  const body = {
    kind: 'electronic',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100',
  } as const;

  it('архивная запись своей заявки читается — без расшифровки', async () => {
    const { request } = await core.submitExchangeRequest(merchant, { ...body, payout: PAYOUT });
    // Запись из тела запроса в список получателей не попадает…
    expect(await core.listRequisites(merchant)).toEqual([]);

    // …а по заявке она видна: вид, банк и открытый хвост.
    const recipient = await core.getExchangeRequestRecipient(merchant, request.id);
    expect(recipient?.kind).toBe('card');
    expect(recipient?.bankName).toBe('Сбербанк');
    expect(recipient?.cardLast4).toBe('1111');
    // Полного номера в ответе нет ни в каком поле.
    expect(JSON.stringify(recipient)).not.toContain('4111111111111111');
  });

  it('чужая заявка — «не найдена», а не запись чужого получателя', async () => {
    const other = await givenMerchant({ email: 'other@example.com', name: 'Другой' });
    const { request } = await core.submitExchangeRequest(other, { ...body, payout: PAYOUT });

    await expect(core.getExchangeRequestRecipient(merchant, request.id)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  /*
   * Защита в глубину, и сцена у неё намеренно недостижимая: ссылку на
   * чужую запись операция подачи отвергает, и поставить её можно только
   * мимо ядра. Проверяется здесь ровно поэтому — принадлежность записи
   * операция сверяет отдельно от принадлежности заявки, и без теста эту
   * вторую сверку можно убрать, ничего не уронив. А цена ошибки —
   * хвост чужой карты на экране.
   */
  it('чужую запись не показывает, даже если на неё ссылается своя заявка', async () => {
    const stranger = await givenMerchant({ email: 'other@example.com', name: 'Другой' });
    const theirs = await core.submitExchangeRequest(stranger, {
      ...body,
      payout: { kind: 'card', bankName: 'Т-Банк', cardNumber: '5555555555554444' },
    });
    const mine = await core.submitExchangeRequest(merchant, { ...body, payout: PAYOUT });
    await db
      .update(exchangeRequests)
      .set({ requisitesId: theirs.request.requisitesId })
      .where(eq(exchangeRequests.id, mine.request.id));

    const recipient = await core.getExchangeRequestRecipient(merchant, mine.request.id);
    expect(recipient).toBeNull();
    expect(JSON.stringify(recipient)).not.toContain('4444');
  });

  /*
   * Сцена — наличная заявка клиента, а не заявка мерчанта с затёртой
   * ссылкой: у мерчанта заявок без получателя не бывает, наличную ядро
   * у него не принимает. Операция же общая на обоих владельцев, и
   * получателя нет именно у наличной — ей он не положен.
   */
  it('заявка без получателя отвечает пустотой, а не ошибкой', async () => {
    await core.registerClient({ telegramUserId: 100n });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      ...body,
      kind: 'cash',
    });
    expect(request.requisitesId).toBeNull();

    expect(await core.getExchangeRequestRecipient(asClient(100n), request.id)).toBeNull();
  });
});

/**
 * Даты в списке заявок. Отбор по дате подачи у списка и счёта был и
 * раньше — им пользуется выгрузка CSV, — а раскладка по состояниям дат
 * не знала: на странице заявок она кормит плитки, и плитка «Исполнены
 * 10» над списком за неделю из двух строк считала бы не то, что
 * показано под ней.
 */
describe('заявки за период', () => {
  async function submitAt(when: string, reference: string): Promise<string> {
    const { request } = await core.submitExchangeRequest(merchant, {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      payout: PAYOUT,
      reference,
    });
    await db
      .update(exchangeRequests)
      .set({ createdAt: new Date(when) })
      .where(eq(exchangeRequests.id, request.id));
    return request.id;
  }

  const from = new Date('2026-09-14T00:00:00Z');
  const to = new Date('2026-09-20T23:59:59.999Z');

  it('список, счёт и раскладка считают одни и те же заявки', async () => {
    await submitAt('2026-09-10T12:00:00Z', 'до периода');
    const inside = await submitAt('2026-09-15T12:00:00Z', 'в периоде');
    const cancelled = await submitAt('2026-09-16T12:00:00Z', 'в периоде, отменена');
    await submitAt('2026-09-21T00:00:00Z', 'после периода');
    await core.cancelOwnExchangeRequest(merchant, cancelled);

    const rows = await core.listExchangeRequests(merchant, { from, to });
    expect(rows.map((row) => row.id).sort()).toEqual([inside, cancelled].sort());
    expect(await core.countExchangeRequests(merchant, { from, to })).toBe(2);
    expect(await core.countExchangeRequestsByStatus(merchant, { from, to })).toEqual({
      new: 1,
      in_progress: 0,
      rate_confirmed: 0,
      payment_received: 0,
      completed: 0,
      cancelled: 1,
    });
  });

  it('границы включительны с обеих сторон', async () => {
    const first = await submitAt('2026-09-14T00:00:00Z', 'первая миллисекунда');
    const last = await submitAt('2026-09-20T23:59:59.999Z', 'последняя миллисекунда');

    const rows = await core.listExchangeRequests(merchant, { from, to });
    expect(rows.map((row) => row.id).sort()).toEqual([first, last].sort());
  });

  it('период сужает и поиск: оба условия действуют разом', async () => {
    await submitAt('2026-09-10T12:00:00Z', 'order-1');
    const wanted = await submitAt('2026-09-15T12:00:00Z', 'order-2');
    await submitAt('2026-09-16T12:00:00Z', 'booking-3');

    const rows = await core.listExchangeRequests(merchant, { from, to, search: 'order' });
    expect(rows.map((row) => row.id)).toEqual([wanted]);
    expect(
      (await core.countExchangeRequestsByStatus(merchant, { from, to, search: 'order' })).new,
    ).toBe(1);
  });
});

/**
 * Каким ключом подана заявка.
 *
 * Пишется в момент подачи, потому что задним числом не восстанавливается:
 * журнал вызовов с заявкой не связан, а у `POST /v1/exchange-requests`
 * заявки в момент записи вызова ещё нет. Так уже случилось с источником
 * (`source`, миграция 0033) — у всех заявок до него он пуст навсегда, и
 * второй такой дырки заводить не стали.
 *
 * Отвечает на два вопроса. Мерчанту: «каким ключом это подано» — когда
 * ключей несколько, у сайта и у бухгалтерии свой. И на более важный:
 * отзывая ключ, видно, что через него прошло.
 */
describe('ключ подачи', () => {
  const body = {
    kind: 'electronic',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100',
    payout: PAYOUT,
  } as const;

  it('названный при подаче — доезжает до ответа, списка и карточки', async () => {
    const { key } = await core.issueApiKey(merchant, { label: 'сайт' });

    const { request } = await core.submitExchangeRequest(merchant, {
      ...body,
      source: 'api',
      apiKeyId: key.id,
    });
    expect(request.apiKeyId).toBe(key.id);

    const [listed] = await core.listExchangeRequests(merchant);
    expect(listed?.apiKeyId).toBe(key.id);
    expect((await core.getExchangeRequest(merchant, request.id)).apiKeyId).toBe(key.id);
  });

  it('поданная из кабинета ключа не имеет', async () => {
    const { request } = await core.submitExchangeRequest(merchant, { ...body, source: 'cabinet' });
    expect(request.apiKeyId).toBeNull();
  });

  /*
   * Ключ принадлежит кабинету, и заявка ссылается на свой. Чужой
   * отвергает база — так же, как чужого получателя: ограничение надёжнее
   * проверки, которую можно забыть повторить во втором месте подачи.
   */
  it('чужой ключ база не принимает', async () => {
    const stranger = await givenMerchant({ email: 'other@example.com', name: 'Другой' });
    const { key: theirs } = await core.issueApiKey(stranger, { label: 'чужой' });

    await expect(
      core.submitExchangeRequest(merchant, { ...body, source: 'api', apiKeyId: theirs.id }),
    ).rejects.toThrow();
  });

  /*
   * Отозванный ключ заявок больше не подаёт, но поданные им остаются с
   * ним: отзыв — это «больше не пускать», а не «забыть, что было».
   */
  it('отзыв ключа заявку с ним не трогает', async () => {
    const { key } = await core.issueApiKey(merchant, { label: 'сайт' });
    const { request } = await core.submitExchangeRequest(merchant, {
      ...body,
      source: 'api',
      apiKeyId: key.id,
    });

    await core.revokeApiKey(merchant, key.id);

    expect((await core.getExchangeRequest(merchant, request.id)).apiKeyId).toBe(key.id);
  });
});
