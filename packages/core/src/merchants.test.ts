import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { merchantEmailTokens } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore } from './index.js';
import { givenStaff } from './test-support.js';

/**
 * Мерчант в ядре: анкета, почта, пароль и решение администратора
 * (docs/adr/0017).
 *
 * Против настоящей базы, как и остальные операции: «ровно один
 * владелец», уникальность почты и обязательность причины отказа
 * выражены ограничениями Postgres, и мок их не проверит.
 */

const db = testDatabase();
const core = createCore({ db });

const ANKETA = {
  email: 'shop@example.com',
  password: 'правильная лошадь батарейка',
  name: 'Оплатишка',
  site: 'https://oplatishka.example',
  contactName: 'Пётр',
  phone: '+7 999 000-00-00',
  about: 'Оплачиваем подписки клиентов, хотим выплаты в валюте',
};

beforeEach(() => resetDatabase(db));
afterAll(() => closeTestDatabase());

/** Ключ из письма: наружу он уходит только уведомлением. */
function tokenOf(result: { notifications: readonly { kind: string }[] }, kind: string): string {
  const found = result.notifications.find((one) => one.kind === kind);
  if (!found || !('token' in found)) {
    throw new Error(`В ответе нет уведомления ${kind}`);
  }
  return found.token as string;
}

describe('анкета мерчанта', () => {
  it('заводится на рассмотрении и просит подтвердить почту', async () => {
    const result = await core.registerMerchant(ANKETA);

    expect(result.merchant.status).toBe('pending');
    expect(result.merchant.emailVerifiedAt).toBeNull();
    expect(result.notifications).toEqual([
      expect.objectContaining({
        kind: 'merchant-email-verification',
        to: { kind: 'merchant', merchantId: result.merchant.id, email: 'shop@example.com' },
      }),
    ]);
  });

  /**
   * «Shop@…» и «shop@…» — один ящик. Два аккаунта на него означали бы,
   * что письмо о втором приходит владельцу первого.
   */
  /**
   * Занятость почты сторожит индекс базы, а не проверка перед вставкой:
   * между «занята ли» и «пишу» вклинивается вторая вкладка, и разнять
   * их может только база. Наружу это уходит теми же словами, что и
   * обычный отказ, — не пятисотым ответом.
   */
  it('почта приводится к нижнему регистру и занимается один раз', async () => {
    await core.registerMerchant({ ...ANKETA, email: 'Shop@Example.com' });

    await expect(core.registerMerchant(ANKETA)).rejects.toThrow(/уже заведён/i);
  });

  /**
   * Сайт из анкеты панель рисует ссылкой, а анкету заводит кто угодно
   * снаружи: «javascript:» в этом поле — клик администратора в контексте
   * панели.
   */
  it('сайт принимается только по http и https', async () => {
    await expect(
      core.registerMerchant({ ...ANKETA, site: 'javascript:alert(1)' }),
    ).rejects.toThrow(/сайт/i);
    await expect(core.registerMerchant({ ...ANKETA, site: 'oplatishka.ru' })).rejects.toThrow(
      /сайт/i,
    );

    const ok = await core.registerMerchant({
      ...ANKETA,
      email: 'ok@example.com',
      site: 'https://oplatishka.example/pay',
    });
    expect(ok.merchant.site).toBe('https://oplatishka.example/pay');
  });

  it('отвергает почту с опечаткой и короткий пароль', async () => {
    await expect(core.registerMerchant({ ...ANKETA, email: 'shop.example.com' })).rejects.toThrow(
      /почта/i,
    );
    await expect(core.registerMerchant({ ...ANKETA, password: 'коротко' })).rejects.toThrow(
      /пароль/i,
    );
  });

  it('подтверждается ключом из письма, и второй раз тот же ключ не проходит', async () => {
    const registered = await core.registerMerchant(ANKETA);
    const token = tokenOf(registered, 'merchant-email-verification');

    const verified = await core.verifyMerchantEmail(token);
    expect(verified.emailVerifiedAt).not.toBeNull();

    await expect(core.verifyMerchantEmail(token)).rejects.toThrow(/ссылк/i);
  });

  /**
   * Анкета от ящика, до которого письмо не дошло, — неизвестно чья, и
   * рассматривать её нельзя.
   */
  it('до подтверждения почты администратору не показывается', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const registered = await core.registerMerchant(ANKETA);

    expect(await core.listMerchants(admin, { status: 'pending' })).toEqual([]);

    await core.verifyMerchantEmail(tokenOf(registered, 'merchant-email-verification'));
    const waiting = await core.listMerchants(admin, { status: 'pending' });
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.name).toBe('Оплатишка');
  });
});

describe('вход мерчанта', () => {
  async function registered(): Promise<string> {
    const result = await core.registerMerchant(ANKETA);
    await core.verifyMerchantEmail(tokenOf(result, 'merchant-email-verification'));
    return result.merchant.id;
  }

  it('пускает по почте и паролю', async () => {
    const merchantId = await registered();

    const session = await core.beginMerchantLogin({
      email: 'SHOP@example.com',
      password: ANKETA.password,
    });
    expect(session.merchantId).toBe(merchantId);
    expect(session.sessionEpoch).toBe(1);
  });

  /**
   * Отказ один на «нет такой почты» и «пароль не тот»: разные ответы
   * говорили бы подбирающему, на каком шаге он остановился.
   */
  it('отказывает одинаково незнакомой почте и неверному паролю', async () => {
    await registered();

    const wrongPassword = core.beginMerchantLogin({
      email: ANKETA.email,
      password: 'совсем другой пароль',
    });
    const unknownEmail = core.beginMerchantLogin({
      email: 'nobody@example.com',
      password: ANKETA.password,
    });

    await expect(wrongPassword).rejects.toThrow(/почта или пароль/i);
    await expect(unknownEmail).rejects.toThrow(/почта или пароль/i);
  });

  /**
   * Смена пароля обрывает все сессии разом: иначе угнанная сессия
   * пережила бы смену пароля, ради которой её и меняли.
   */
  it('смена пароля увеличивает поколение сессии', async () => {
    const merchantId = await registered();
    const actor = { type: 'merchant', merchantId } as const;

    await core.changeMerchantPassword(actor, {
      currentPassword: ANKETA.password,
      newPassword: 'другая длинная фраза',
    });

    const session = await core.beginMerchantLogin({
      email: ANKETA.email,
      password: 'другая длинная фраза',
    });
    expect(session.sessionEpoch).toBe(2);
    await expect(core.getMerchantSession(merchantId, 1)).rejects.toThrow();
    expect((await core.getMerchantSession(merchantId, 2)).merchantId).toBe(merchantId);
  });

  it('смена пароля без нынешнего не проходит', async () => {
    const merchantId = await registered();

    await expect(
      core.changeMerchantPassword(
        { type: 'merchant', merchantId },
        { currentPassword: 'не тот', newPassword: 'другая длинная фраза' },
      ),
    ).rejects.toThrow(/почта или пароль/i);
  });

  it('сброс пароля ключом из письма меняет пароль и обрывает сессии', async () => {
    const merchantId = await registered();

    const asked = await core.requestMerchantPasswordReset(ANKETA.email);
    await core.resetMerchantPassword(
      tokenOf(asked, 'merchant-password-reset'),
      'третья длинная фраза',
    );

    const session = await core.beginMerchantLogin({
      email: ANKETA.email,
      password: 'третья длинная фраза',
    });
    expect(session.merchantId).toBe(merchantId);
    expect(session.sessionEpoch).toBe(2);
  });

  /**
   * По незнакомой почте сброс отвечает так же, как по знакомой: иначе
   * форма «забыли пароль» стала бы способом перебирать, кто здесь есть.
   */
  it('сброс по незнакомой почте молчит, а не отказывает', async () => {
    const asked = await core.requestMerchantPasswordReset('nobody@example.com');
    expect(asked.notifications).toEqual([]);
  });
});

describe('решение администратора', () => {
  async function waiting(): Promise<string> {
    const result = await core.registerMerchant(ANKETA);
    await core.verifyMerchantEmail(tokenOf(result, 'merchant-email-verification'));
    return result.merchant.id;
  }

  it('одобрение открывает кабинет и уходит письмом', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const merchantId = await waiting();

    const result = await core.approveMerchant(admin, merchantId);
    expect(result.merchant.status).toBe('active');
    expect(result.merchant.approvedAt).not.toBeNull();
    expect(result.notifications).toEqual([
      expect.objectContaining({ kind: 'merchant-application-decided' }),
    ]);
  });

  it('отклонение без причины не проходит, а с причиной её и показывает', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const merchantId = await waiting();

    await expect(core.rejectMerchant(admin, merchantId, { reason: '  ' })).rejects.toThrow(
      /причин/i,
    );

    const result = await core.rejectMerchant(admin, merchantId, {
      reason: 'не отвечает на письма',
    });
    expect(result.merchant.status).toBe('rejected');
    expect(result.merchant.rejectionReason).toBe('не отвечает на письма');
    expect(result.notifications).toEqual([
      expect.objectContaining({
        kind: 'merchant-application-decided',
        rejectionReason: 'не отвечает на письма',
      }),
    ]);
  });

  /**
   * Одобрение открывает право создавать обязательства сервиса по курсу.
   * Это решение того же рода, что наценка, и менеджеру оно не отдаётся.
   */
  it('менеджеру недоступно', async () => {
    const manager = await givenStaff({ role: 'manager' });
    const merchantId = await waiting();

    await expect(core.approveMerchant(manager, merchantId)).rejects.toThrow(/администратор/i);
    await expect(
      core.rejectMerchant(manager, merchantId, { reason: 'нет' }),
    ).rejects.toThrow(/администратор/i);
    await expect(core.setMerchantActive(manager, merchantId, false)).rejects.toThrow(
      /администратор/i,
    );
  });

  it('неподтверждённую почту одобрить нельзя', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const { merchant } = await core.registerMerchant(ANKETA);

    await expect(core.approveMerchant(admin, merchant.id)).rejects.toThrow(/почт/i);
  });

  it('отключение и включение ходят только между активным и отключённым', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const merchantId = await waiting();

    // Отключить можно активного, а не ждущего рассмотрения.
    await expect(core.setMerchantActive(admin, merchantId, false)).rejects.toThrow();

    await core.approveMerchant(admin, merchantId);
    const off = await core.setMerchantActive(admin, merchantId, false);
    expect(off.status).toBe('disabled');
    expect(off.disabledAt).not.toBeNull();

    const on = await core.setMerchantActive(admin, merchantId, true);
    expect(on.status).toBe('active');
    expect(on.disabledAt).toBeNull();
  });

  it('карточка отдаёт анкету и контакты, но не хеш пароля', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const merchantId = await waiting();

    const card = await core.getMerchantCard(admin, merchantId);
    expect(card).toMatchObject({
      id: merchantId,
      name: 'Оплатишка',
      email: 'shop@example.com',
      contactName: 'Пётр',
      about: ANKETA.about,
      status: 'pending',
    });
    expect(JSON.stringify(card)).not.toContain('argon2');
  });

  /** Список и карточка нужны обеим ролям: менеджер отвечает по заявке. */
  it('список и карточка открыты менеджеру', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const manager = await givenStaff({ role: 'manager' });
    const merchantId = await waiting();
    await core.approveMerchant(admin, merchantId);

    expect(await core.listMerchants(manager, { status: 'active' })).toHaveLength(1);
    expect((await core.getMerchantCard(manager, merchantId)).id).toBe(merchantId);
  });

  it('находит по названию и по почте', async () => {
    const admin = await givenStaff({ role: 'admin' });
    await waiting();

    expect(await core.listMerchants(admin, { query: 'оплат' })).toHaveLength(1);
    expect(await core.listMerchants(admin, { query: 'SHOP@example' })).toHaveLength(1);
    expect(await core.listMerchants(admin, { query: 'другой' })).toEqual([]);
  });

  /**
   * Знаки шаблона в поиске — это набранные человеком знаки, а не
   * подстановка: «%» в поле поиска означает «мерчант с процентом в
   * названии», а не «покажи всех».
   */
  it('процент и подчёркивание в поиске ничего не подставляют', async () => {
    const admin = await givenStaff({ role: 'admin' });
    await waiting();

    expect(await core.listMerchants(admin, { query: '%' })).toEqual([]);
    expect(await core.listMerchants(admin, { query: 'Оплат_шка' })).toEqual([]);
  });

  it('считает мерчантов по состояниям', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const merchantId = await waiting();

    expect(await core.countMerchants(admin, { status: 'pending' })).toBe(1);
    await core.approveMerchant(admin, merchantId);
    expect(await core.countMerchants(admin, { status: 'pending' })).toBe(0);
    expect(await core.countMerchants(admin, { status: 'active' })).toBe(1);
  });

  /** Решение о мерчанте — такая же правка настроек сервиса, как наценка. */
  it('одобрение и отключение пишутся в журнал настроек', async () => {
    const admin = await givenStaff({ role: 'admin' });
    const merchantId = await waiting();

    await core.approveMerchant(admin, merchantId);
    await core.setMerchantActive(admin, merchantId, false);

    const log = await core.listSettingsAuditLog(admin);
    expect(log.map((entry) => entry.subject)).toEqual(['merchant', 'merchant']);
  });
});

describe('срок ссылки из письма', () => {
  /**
   * Ссылка живёт сутки, и просроченная не подтверждает ничего: письмо
   * лежит в чужом ящике ровно столько, сколько ящик существует.
   */
  it('просроченная ссылка не подтверждает почту', async () => {
    const registered = await core.registerMerchant(ANKETA);
    const token = tokenOf(registered, 'merchant-email-verification');

    await db
      .update(merchantEmailTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(merchantEmailTokens.merchantId, registered.merchant.id));

    await expect(core.verifyMerchantEmail(token)).rejects.toThrow(/ссылк/i);
  });
});
