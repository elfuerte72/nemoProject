import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  clientRequisites,
  clients,
  exchangeRequests,
  referrals,
  serviceSettings,
  transferNetworks,
} from './schema.js';
import { closeTestDatabase, resetDatabase, testDatabase } from './testing.js';

/**
 * Правила, которые защищает сама база, а не код.
 *
 * Все они охраняют деньги, и все они должны выдерживать вызов в обход
 * прикладного слоя: повторно доставленный запрос, ручную правку в
 * консоли, ошибку в будущей операции. Проверка, живущая только в
 * TypeScript, от этого не спасает.
 *
 * Второго seam эти тесты не заводят: через операции такую строку не
 * составить — самореферал они отбрасывают раньше, чем дело дойдёт до
 * базы. Проверяется здесь сам последний рубеж, который спека называет
 * носителем гарантии, а не прикладная логика поверх него.
 */

const db = testDatabase();

beforeEach(() => resetDatabase(db));
afterAll(() => closeTestDatabase());

async function insertClient(telegramUserId: bigint, referrerId?: bigint): Promise<void> {
  await db.insert(clients).values({
    telegramUserId,
    referralCode: `ref-${telegramUserId}`,
    ...(referrerId === undefined ? {} : { referrerId }),
  });
}

describe('заявка на обмен', () => {
  it('не может стать исполненной без указанного дохода', async () => {
    await insertClient(1n);
    const [request] = await db
      .insert(exchangeRequests)
      .values({
        clientId: 1n,
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
      })
      .returning();

    await expect(
      db
        .update(exchangeRequests)
        .set({ status: 'completed' })
        .where(eq(exchangeRequests.id, request!.id)),
    ).rejects.toThrow(/exchange_requests_income_on_completion/);
  });

  it('становится исполненной, когда доход указан', async () => {
    await insertClient(1n);
    const [request] = await db
      .insert(exchangeRequests)
      .values({
        clientId: 1n,
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
      })
      .returning();

    const [completed] = await db
      .update(exchangeRequests)
      .set({ status: 'completed', serviceIncome: '250.5', serviceIncomeCode: 'RUB' })
      .where(eq(exchangeRequests.id, request!.id))
      .returning();

    expect(completed!.status).toBe('completed');
  });
});

describe('реферальная связь', () => {
  it('не может вести клиента к самому себе', async () => {
    await insertClient(1n);

    await expect(
      db.insert(referrals).values({ referrerId: 1n, referralId: 1n, line: 1 }),
    ).rejects.toThrow(/referrals_not_self/);
  });

  it('не позволяет клиенту быть собственным реферером', async () => {
    await expect(insertClient(1n, 1n)).rejects.toThrow(/clients_no_self_referral/);
  });

  it('не заходит глубже второй линии', async () => {
    await insertClient(1n);
    await insertClient(2n);

    await expect(
      db.insert(referrals).values({ referrerId: 1n, referralId: 2n, line: 3 }),
    ).rejects.toThrow(/referrals_line_range/);
  });
});

/**
 * Реквизит описывает один способ получения целиком. Правило носит база,
 * а не форма: форма — не единственный способ создать запись, а
 * последствие у чужого поля одно — сеть у карты или номер карты у
 * кошелька означают перевод не туда, откуда не возвращаются.
 */
describe('реквизиты клиента', () => {
  const SEALED = Buffer.from('конверт');

  beforeEach(async () => {
    await insertClient(1n);
    await db.insert(transferNetworks).values({ code: 'TRC20' });
  });

  it('по телефону — с банком и телефоном', async () => {
    const [row] = await db
      .insert(clientRequisites)
      .values({ clientId: 1n, kind: 'phone', bankName: 'Сбербанк', phone: '+79990000000' })
      .returning();

    expect(row!.kind).toBe('phone');
  });

  it('по телефону — не без телефона', async () => {
    await expect(
      db.insert(clientRequisites).values({ clientId: 1n, kind: 'phone', bankName: 'Сбербанк' }),
    ).rejects.toThrow(/client_requisites_fields_by_kind/);
  });

  it('на карту — не без банка', async () => {
    await expect(
      db.insert(clientRequisites).values({
        clientId: 1n,
        kind: 'card',
        cardLast4: '5678',
        cardSealed: SEALED,
      }),
    ).rejects.toThrow(/client_requisites_fields_by_kind/);
  });

  it('на карту — не с сетью: сеть у карты означает ошибку ввода', async () => {
    await expect(
      db.insert(clientRequisites).values({
        clientId: 1n,
        kind: 'card',
        bankName: 'Тинькофф',
        cardLast4: '5678',
        cardSealed: SEALED,
        network: 'TRC20',
      }),
    ).rejects.toThrow(/client_requisites_fields_by_kind/);
  });

  it('на кошелёк — с сетью и адресом', async () => {
    const [row] = await db
      .insert(clientRequisites)
      .values({
        clientId: 1n,
        kind: 'wallet',
        network: 'TRC20',
        addressSealed: SEALED,
        addressHint: 'TQmX…aU6e',
      })
      .returning();

    expect(row!.network).toBe('TRC20');
  });

  it('на кошелёк — не без сети: один адрес живёт в нескольких', async () => {
    await expect(
      db.insert(clientRequisites).values({
        clientId: 1n,
        kind: 'wallet',
        addressSealed: SEALED,
        addressHint: 'TQmX…aU6e',
      }),
    ).rejects.toThrow(/client_requisites_fields_by_kind/);
  });

  it('на кошелёк — не с номером карты', async () => {
    await expect(
      db.insert(clientRequisites).values({
        clientId: 1n,
        kind: 'wallet',
        network: 'TRC20',
        addressSealed: SEALED,
        addressHint: 'TQmX…aU6e',
        cardLast4: '5678',
        cardSealed: SEALED,
      }),
    ).rejects.toThrow(/client_requisites_fields_by_kind/);
  });

  it('не заводится в сети, которой нет в справочнике', async () => {
    await expect(
      db.insert(clientRequisites).values({
        clientId: 1n,
        kind: 'wallet',
        network: 'ERC20',
        addressSealed: SEALED,
        addressHint: 'TQmX…aU6e',
      }),
    ).rejects.toThrow(/transfer_networks/);
  });
});

describe('настройки сервиса', () => {
  it('существуют сразу после применения миграций', async () => {
    const [settings] = await db.select().from(serviceSettings);

    expect(settings).toBeDefined();
    expect(settings!.referralLine1Bps).toBeGreaterThan(0);
  });

  it('существуют в единственном экземпляре', async () => {
    await expect(db.insert(serviceSettings).values({ id: 1 })).rejects.toThrow();
  });
});
