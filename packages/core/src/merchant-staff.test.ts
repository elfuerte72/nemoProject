import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore } from './index.js';
import {
  givenCurrencyPair,
  givenMerchant,
  type MerchantOwnerActor,
} from './test-support.js';

/**
 * Люди у мерчанта: роли и доступ (тикет 17 трекера кабинета).
 *
 * Против настоящей базы: «владелец ровно один» и «одна почта — один
 * кабинет» выражены индексами Postgres, а закрытие доступа поднимает
 * поколение сессии — то же поле, которым обрывает вход смена пароля.
 */

const db = testDatabase();
// Ключ шифрования нужен тем проверкам, где заводят получателя: реквизит
// уходит в базу конвертом, и без публичного ключа операция откажет.
const core = createCore({
  db,
  requisites: { publicKey: generateRequisiteKeyPair().publicKey },
});

beforeEach(() => resetDatabase(db));
afterAll(() => closeTestDatabase());

const OPERATOR = {
  email: 'operator@example.com',
  password: 'правильная лошадь батарейка',
  name: 'Анна',
  role: 'operator',
} as const;

describe('состав людей у мерчанта', () => {
  it('владелец стоит в списке первым и один', async () => {
    const owner = await givenMerchant();

    const people = await core.listMerchantUsers(owner);
    expect(people).toHaveLength(1);
    expect(people[0]?.role).toBe('owner');
    expect(people[0]?.id).toBe(owner.userId);
  });

  it('владелец заводит оператора, и тот входит по своему паролю', async () => {
    const owner = await givenMerchant();

    const added = await core.addMerchantUser(owner, OPERATOR);
    expect(added.role).toBe('operator');
    expect(added.disabledAt).toBeNull();

    const session = await core.beginMerchantLogin({
      email: 'OPERATOR@example.com',
      password: OPERATOR.password,
    });
    expect(session.merchantId).toBe(owner.merchantId);
    expect(session.userId).toBe(added.id);
    expect(session.role).toBe('operator');
  });

  it('второго владельца завести нельзя', async () => {
    const owner = await givenMerchant();

    await expect(core.addMerchantUser(owner, { ...OPERATOR, role: 'owner' })).rejects.toThrow(
      /владелец/i,
    );
  });

  /**
   * Почта — то, чем входят: одна почта в двух кабинетах означала бы
   * вопрос, в какой из них пускать вошедшего.
   */
  it('занятую почту не принимает — ни свою, ни чужого кабинета', async () => {
    const owner = await givenMerchant({ email: 'shop@example.com' });
    const other = await givenMerchant({ email: 'other@example.com' });
    await core.addMerchantUser(owner, OPERATOR);

    await expect(core.addMerchantUser(owner, OPERATOR)).rejects.toThrow(/уже заведён/i);
    await expect(core.addMerchantUser(other, OPERATOR)).rejects.toThrow(/уже заведён/i);
  });

  it('короткий пароль, почту с опечаткой и пустое имя отвергает', async () => {
    const owner = await givenMerchant();

    await expect(
      core.addMerchantUser(owner, { ...OPERATOR, password: 'коротко' }),
    ).rejects.toThrow(/пароль/i);
    await expect(
      core.addMerchantUser(owner, { ...OPERATOR, email: 'operator.example.com' }),
    ).rejects.toThrow(/почта/i);
    await expect(core.addMerchantUser(owner, { ...OPERATOR, name: '  ' })).rejects.toThrow(
      /имя/i,
    );
  });

  it('людей мерчанта ведёт только владелец', async () => {
    const owner = await givenMerchant();
    const added = await core.addMerchantUser(owner, OPERATOR);
    const operator = {
      type: 'merchant',
      merchantId: owner.merchantId,
      userId: added.id,
      role: 'operator',
    } as const;

    await expect(core.listMerchantUsers(operator)).rejects.toThrow(/владелец/i);
    await expect(
      core.addMerchantUser(operator, { ...OPERATOR, email: 'third@example.com' }),
    ).rejects.toThrow(/владелец/i);
  });

  it('в чужой кабинет не заглядывает', async () => {
    const owner = await givenMerchant();
    const other = await givenMerchant({ email: 'other@example.com' });
    const added = await core.addMerchantUser(owner, OPERATOR);

    await expect(core.updateMerchantUser(other, added.id, { name: 'Чужой' })).rejects.toThrow(
      /нет/i,
    );
  });
});

describe('роль и пароль человека', () => {
  it('роль меняется, и сессия при этом не обрывается', async () => {
    const owner = await givenMerchant();
    const added = await core.addMerchantUser(owner, OPERATOR);

    const changed = await core.updateMerchantUser(owner, added.id, { role: 'viewer' });
    expect(changed.role).toBe('viewer');
    expect((await core.getMerchantSession(added.id, 1)).role).toBe('viewer');
  });

  it('владельцу роль не меняется', async () => {
    const owner = await givenMerchant();

    await expect(
      core.updateMerchantUser(owner, owner.userId!, { role: 'operator' }),
    ).rejects.toThrow(/владелец/i);
  });

  /**
   * Пароль владелец задаёт сам и передаёт лично — приглашение по почте
   * добавило бы подтверждение адреса ради ничего. Поколение при этом
   * растёт: заданный заново пароль означает, что прежним входить
   * больше нельзя.
   */
  it('новый пароль обрывает прежние сессии человека', async () => {
    const owner = await givenMerchant();
    const added = await core.addMerchantUser(owner, OPERATOR);

    await core.setMerchantUserPassword(owner, added.id, 'другая длинная фраза');

    await expect(core.getMerchantSession(added.id, 1)).rejects.toThrow();
    const session = await core.beginMerchantLogin({
      email: OPERATOR.email,
      password: 'другая длинная фраза',
    });
    expect(session.sessionEpoch).toBe(2);
  });

  it('себе пароль так не меняют: для этого настройки со старым паролем', async () => {
    const owner = await givenMerchant();

    await expect(
      core.setMerchantUserPassword(owner, owner.userId!, 'другая длинная фраза'),
    ).rejects.toThrow(/себе/i);
  });
});

describe('закрытие доступа', () => {
  it('закрытый не входит, а его сессия обрывается в ту же секунду', async () => {
    const owner = await givenMerchant();
    const added = await core.addMerchantUser(owner, OPERATOR);
    expect((await core.getMerchantSession(added.id, 1)).userId).toBe(added.id);

    const closed = await core.setMerchantUserAccess(owner, added.id, { allowed: false });
    expect(closed.disabledAt).not.toBeNull();

    await expect(core.getMerchantSession(added.id, 1)).rejects.toThrow();
    await expect(
      core.beginMerchantLogin({ email: OPERATOR.email, password: OPERATOR.password }),
    ).rejects.toThrow(/доступ/i);
  });

  it('открытый заново входит своим прежним паролем', async () => {
    const owner = await givenMerchant();
    const added = await core.addMerchantUser(owner, OPERATOR);
    await core.setMerchantUserAccess(owner, added.id, { allowed: false });

    const opened = await core.setMerchantUserAccess(owner, added.id, { allowed: true });
    expect(opened.disabledAt).toBeNull();

    const session = await core.beginMerchantLogin({
      email: OPERATOR.email,
      password: OPERATOR.password,
    });
    expect(session.userId).toBe(added.id);
  });

  /**
   * Кабинет без хозяина остался бы без того, кому сервис пишет о
   * деньгах: закрыть доступ владельцу нельзя, даже себе.
   */
  it('владельцу доступ не закрывается', async () => {
    const owner = await givenMerchant();

    await expect(
      core.setMerchantUserAccess(owner, owner.userId!, { allowed: false }),
    ).rejects.toThrow(/владельц/i);
  });

  /**
   * Заявка — обязательство сервиса перед мерчантом, а не перед
   * человеком: закрытый доступ истории не меняет.
   */
  it('человек остаётся в списке с отметкой, а не исчезает', async () => {
    const owner = await givenMerchant();
    const added = await core.addMerchantUser(owner, OPERATOR);
    await core.setMerchantUserAccess(owner, added.id, { allowed: false });

    const people = await core.listMerchantUsers(owner);
    expect(people.map((one) => one.id)).toContain(added.id);
    expect(people.find((one) => one.id === added.id)?.disabledAt).not.toBeNull();
  });
});

/**
 * Что роль позволяет делать с заявками. Правило одно на ядро и экран
 * (`merchantRoleCan` в `@nemo/types`), и проверяется оно в операции:
 * спрятанная в кабинете кнопка обходится любым другим путём к той же
 * операции — хоть ключом API, хоть запросом к маршруту.
 */
describe('заявки и роль', () => {
  const REQUEST = {
    kind: 'electronic',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100',
    payout: { kind: 'card', bankName: 'Сбербанк', cardNumber: '4111111111111111' },
  } as const;

  beforeEach(async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  });

  async function asUser(owner: MerchantOwnerActor, role: 'operator' | 'viewer') {
    const added = await core.addMerchantUser(owner, {
      ...OPERATOR,
      email: `${role}@example.com`,
      role,
    });
    return {
      type: 'merchant',
      merchantId: owner.merchantId,
      userId: added.id,
      role,
    } as const;
  }

  it('оператор подаёт заявку, и в ней остаётся он', async () => {
    const owner = await givenMerchant();
    const operator = await asUser(owner, 'operator');

    const { request } = await core.submitExchangeRequest(operator, REQUEST);

    expect(request.submittedByUserId).toBe(operator.userId);
  });

  it('наблюдатель не подаёт и не отменяет', async () => {
    const owner = await givenMerchant();
    const viewer = await asUser(owner, 'viewer');
    const { request } = await core.submitExchangeRequest(owner, REQUEST);

    await expect(core.submitExchangeRequest(viewer, REQUEST)).rejects.toThrow(/наблюдатель/i);
    await expect(core.cancelOwnExchangeRequest(viewer, request.id)).rejects.toThrow(/наблюдатель/i);
  });

  it('наблюдатель не заводит получателей', async () => {
    const owner = await givenMerchant();
    const viewer = await asUser(owner, 'viewer');

    await expect(
      core.saveRequisites(viewer, {
        kind: 'card',
        bankName: 'Сбербанк',
        cardNumber: '4111111111111111',
      }),
    ).rejects.toThrow(/наблюдатель/i);
  });

  /**
   * Заявка по ключу API ничья: ключ принадлежит организации, а не
   * человеку, и назвать автором того, кто ключ выпустил, значило бы
   * записать в историю чужую работу.
   */
  it('заявка по ключу API остаётся без автора', async () => {
    const owner = await givenMerchant();
    const byKey = {
      type: 'merchant',
      merchantId: owner.merchantId,
      userId: null,
      role: 'operator',
    } as const;

    const { request } = await core.submitExchangeRequest(byKey, REQUEST);

    expect(request.submittedByUserId).toBeNull();
  });

  /**
   * Кому сервис пишет о заявке: тому, кто её подал — он ведёт эту
   * сделку, — а по закрытии его доступа владельцу: человеку, который
   * больше не входит, письмо о курсе ни к чему.
   */
  it('письмо о заявке уходит подавшему, а по его закрытии — владельцу', async () => {
    const owner = await givenMerchant({ email: 'owner@example.com' });
    const added = await core.addMerchantUser(owner, OPERATOR);
    const operator = {
      type: 'merchant',
      merchantId: owner.merchantId,
      userId: added.id,
      role: 'operator',
    } as const;

    const submitted = await core.submitExchangeRequest(operator, REQUEST);
    expect(submitted.notifications).toEqual([
      expect.objectContaining({ to: expect.objectContaining({ email: OPERATOR.email }) }),
    ]);

    await core.setMerchantUserAccess(owner, added.id, { allowed: false });
    const cancelled = await core.cancelOwnExchangeRequest(owner, submitted.request.id);
    expect(cancelled.notifications).toEqual([
      expect.objectContaining({ to: expect.objectContaining({ email: 'owner@example.com' }) }),
    ]);
  });
});
