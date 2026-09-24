import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { merchantSessions } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import { givenMerchant } from './test-support.js';

/**
 * Сессии кабинета мерчанта — записи, а не одна подписанная кука
 * (24 сентября 2026, по образцу «Сессий» Love&Pay).
 *
 * Проверяется то, что глазом не видно: отключённая сессия перестаёт
 * пускать в ту же секунду, чужую не отключить, смена пароля обрывает
 * все разом, а просроченная не оживает.
 */

const db = testDatabase();
const core = createCore({ db });

beforeEach(() => resetDatabase(db));
afterAll(() => closeTestDatabase());

const OPERATOR = {
  email: 'operator@example.com',
  password: 'правильная лошадь батарейка',
  name: 'Анна',
  role: 'operator',
} as const;

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';

async function operatorWithLogin(userAgent = MAC, address = '203.0.113.7') {
  const owner = await givenMerchant();
  const added = await core.addMerchantUser(owner, OPERATOR);
  const session = await core.beginMerchantLogin({
    email: OPERATOR.email,
    password: OPERATOR.password,
    userAgent,
    address,
  });
  const actor: Actor = { type: 'merchant', merchantId: owner.merchantId, role: 'operator', userId: added.id };
  return { owner, added, session, actor };
}

describe('вход заводит сессию', () => {
  it('с устройством, адресом и сроком — и по её номеру пускает', async () => {
    const { added, session, actor } = await operatorWithLogin();

    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect((await core.getMerchantSession(added.id, session.sessionId)).userId).toBe(added.id);

    const list = await core.listMerchantSessions(actor);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: session.sessionId, userAgent: MAC, address: '203.0.113.7' });
  });

  it('каждый вход — своя сессия, свежие первыми', async () => {
    const { session: first, actor } = await operatorWithLogin(MAC);
    await db
      .update(merchantSessions)
      .set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(merchantSessions.id, first.sessionId));
    const second = await core.beginMerchantLogin({
      email: OPERATOR.email,
      password: OPERATOR.password,
      userAgent: PHONE,
      address: '198.51.100.9',
    });

    const list = await core.listMerchantSessions(actor);
    expect(list.map((one) => one.id)).toEqual([second.sessionId, first.sessionId]);
  });

  it('номер сессии чужого человека не пускает, даже с верным поколением', async () => {
    const { owner, session } = await operatorWithLogin();
    await expect(core.getMerchantSession(owner.userId, session.sessionId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('номер не того вида — отказ «войдите заново», а не падение базы', async () => {
    const { added } = await operatorWithLogin();
    await expect(core.getMerchantSession(added.id, '1')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('просроченная не пускает', async () => {
    const { added, session } = await operatorWithLogin();
    await db
      .update(merchantSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(merchantSessions.id, session.sessionId));

    await expect(core.getMerchantSession(added.id, session.sessionId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('отключение', () => {
  it('отключённая сессия перестаёт пускать сразу, соседняя живёт', async () => {
    const { added, session: laptop, actor } = await operatorWithLogin(MAC);
    const phone = await core.beginMerchantLogin({
      email: OPERATOR.email,
      password: OPERATOR.password,
      userAgent: PHONE,
    });

    await core.revokeMerchantSession(actor, phone.sessionId);

    await expect(core.getMerchantSession(added.id, phone.sessionId)).rejects.toThrow();
    expect((await core.getMerchantSession(added.id, laptop.sessionId)).userId).toBe(added.id);
    expect((await core.listMerchantSessions(actor)).map((one) => one.id)).toEqual([laptop.sessionId]);
  });

  it('«все, кроме этой» оставляет ту, с которой нажали', async () => {
    const { added, session: laptop, actor } = await operatorWithLogin(MAC);
    const phone = await core.beginMerchantLogin({ email: OPERATOR.email, password: OPERATOR.password });
    const tablet = await core.beginMerchantLogin({ email: OPERATOR.email, password: OPERATOR.password });

    expect(await core.revokeOtherMerchantSessions(actor, laptop.sessionId)).toBe(2);

    for (const gone of [phone, tablet]) {
      await expect(core.getMerchantSession(added.id, gone.sessionId)).rejects.toThrow();
    }
    expect((await core.getMerchantSession(added.id, laptop.sessionId)).userId).toBe(added.id);
  });

  /*
   * Сессии — свойство человека (ADR-0023): владелец закрывает доступ
   * оператору целиком, а не отключает его устройства по одному. Чужая
   * сессия — «не найдена», как чужой ключ.
   */
  it('чужую сессию не отключить — даже владельцу своего кабинета', async () => {
    const { owner, added, session } = await operatorWithLogin();

    await expect(core.revokeMerchantSession(owner, session.sessionId)).rejects.toMatchObject({
      code: 'not-found',
    });
    expect((await core.getMerchantSession(added.id, session.sessionId)).userId).toBe(added.id);
  });

  it('уже отключённую второй раз не отключить: «не найдена»', async () => {
    const { session, actor } = await operatorWithLogin();
    await core.revokeMerchantSession(actor, session.sessionId);
    await expect(core.revokeMerchantSession(actor, session.sessionId)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('ключ API сессий не видит: у него нет человека', async () => {
    const { owner } = await operatorWithLogin();
    const key: Actor = { type: 'merchant', merchantId: owner.merchantId, role: 'operator', userId: null };
    await expect(core.listMerchantSessions(key)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('выход гасит свою сессию: скопированная кука после выхода не пускает', async () => {
    const { added, session } = await operatorWithLogin();
    await core.endMerchantSession(added.id, session.sessionId);
    await expect(core.getMerchantSession(added.id, session.sessionId)).rejects.toThrow();
  });
});

describe('смена пароля и закрытие доступа', () => {
  it('новый пароль обрывает все сессии разом, и в списке их больше нет', async () => {
    const { owner, added, session, actor } = await operatorWithLogin();
    await core.setMerchantUserPassword(owner, added.id, 'другая длинная фраза');

    await expect(core.getMerchantSession(added.id, session.sessionId)).rejects.toThrow();
    expect(await core.listMerchantSessions(actor)).toEqual([]);
  });

  it('закрытый доступ обрывает сессию в ту же секунду', async () => {
    const { owner, added, session } = await operatorWithLogin();
    await core.setMerchantUserAccess(owner, added.id, { allowed: false });
    await expect(core.getMerchantSession(added.id, session.sessionId)).rejects.toThrow();
  });
});

describe('отметка активности', () => {
  it('обновляется не чаще раза в пять минут и несёт последний адрес', async () => {
    const { added, session, actor } = await operatorWithLogin(MAC, '203.0.113.7');

    await core.getMerchantSession(added.id, session.sessionId, { address: '198.51.100.9' });
    expect((await core.listMerchantSessions(actor))[0]!.address).toBe('203.0.113.7');

    const long = new Date(Date.now() - 10 * 60 * 1000);
    await db
      .update(merchantSessions)
      .set({ lastSeenAt: long })
      .where(eq(merchantSessions.id, session.sessionId));
    await core.getMerchantSession(added.id, session.sessionId, { address: '198.51.100.9' });

    const [seen] = await core.listMerchantSessions(actor);
    expect(seen!.address).toBe('198.51.100.9');
    expect(seen!.lastSeenAt.getTime()).toBeGreaterThan(long.getTime());
  });
});

describe('чистка', () => {
  it('убирает просроченные и отключённые старше срока, живые не трогает', async () => {
    const { session: alive, actor } = await operatorWithLogin();
    const revoked = await core.beginMerchantLogin({ email: OPERATOR.email, password: OPERATOR.password });
    const expired = await core.beginMerchantLogin({ email: OPERATOR.email, password: OPERATOR.password });
    await core.revokeMerchantSession(actor, revoked.sessionId);
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await db.update(merchantSessions).set({ revokedAt: old }).where(eq(merchantSessions.id, revoked.sessionId));
    await db.update(merchantSessions).set({ expiresAt: old }).where(eq(merchantSessions.id, expired.sessionId));

    expect(await core.purgeMerchantSessions(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))).toBe(2);
    const left = await db.select({ id: merchantSessions.id }).from(merchantSessions);
    expect(left.map((one) => one.id)).toEqual([alive.sessionId]);
  });
});
