import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  clientRequisites,
  clients,
  currencies,
  exchangeRequests,
  feeScheduleTiers,
  feeSchedules,
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

describe('сетка комиссии', () => {
  /** Заводит пустую сетку и отдаёт её номер. */
  async function insertSchedule(): Promise<string> {
    await db.insert(currencies).values({ code: 'THB', decimals: 2, kind: 'fiat' });
    const [schedule] = await db
      .insert(feeSchedules)
      .values({ toCode: 'THB', payoutMethod: 'bank' })
      .returning({ id: feeSchedules.id });
    return schedule!.id;
  }

  it('не держит ступень с двумя фиксами разом', async () => {
    /*
     * Прежний запрет «двух ставок» сужен 17 августа 2026: формула
     * владельца для евро — «3,3 % и 10 EUR сверху», доля сочетается с
     * любым фиксом. Бессмысленной осталась ровно пара фиксов: один
     * вычитается до умножения на курс, второй после, и вместе они
     * означали бы, что никто не знает, сколько стоит обмен.
     */
    const scheduleId = await insertSchedule();

    await expect(
      db.insert(feeScheduleTiers).values({
        scheduleId,
        upToUsd: '500',
        fixedUsd: '5',
        fixedPayout: '10',
      }),
    ).rejects.toThrow(/fee_schedule_tiers_single_fixed/);
  });

  it('не держит ступень вовсе без ставки', async () => {
    const scheduleId = await insertSchedule();

    await expect(
      db.insert(feeScheduleTiers).values({ scheduleId, upToUsd: '500' }),
    ).rejects.toThrow(/fee_schedule_tiers_any_rate/);
  });

  it('держит долю с фиксом — в долларах и в валюте выдачи', async () => {
    const scheduleId = await insertSchedule();

    await db.insert(feeScheduleTiers).values({
      scheduleId,
      upToUsd: '2000',
      rateBps: 330,
      fixedPayout: '10',
    });
    await db.insert(feeScheduleTiers).values({
      scheduleId,
      upToUsd: null,
      rateBps: 450,
      fixedUsd: '5',
    });

    expect(await db.select().from(feeScheduleTiers)).toHaveLength(2);
  });

  it('не держит отрицательный фикс в валюте выдачи', async () => {
    const scheduleId = await insertSchedule();

    await expect(
      db.insert(feeScheduleTiers).values({
        scheduleId,
        upToUsd: null,
        fixedPayout: '-10',
      }),
    ).rejects.toThrow(/fee_schedule_tiers_payout_non_negative/);
  });

  it('не держит нулевой и отрицательный минимум сетки', async () => {
    // Ноль в поле минимума — опечатка, а не «порога нет»: для «нет»
    // есть пустое значение, и ноль, сохранённый как порог, читался бы
    // администратором как действующее правило.
    await db.insert(currencies).values({ code: 'EUR', decimals: 2, kind: 'fiat' });

    await expect(
      db.insert(feeSchedules).values({ toCode: 'EUR', payoutMethod: 'bank', minUsd: '0' }),
    ).rejects.toThrow(/fee_schedules_min_positive/);
    await expect(
      db.insert(feeSchedules).values({ toCode: 'EUR', payoutMethod: 'bank', minUsd: '-5' }),
    ).rejects.toThrow(/fee_schedules_min_positive/);

    // Положительный — держит, пустой — тем более.
    await db
      .insert(feeSchedules)
      .values({ toCode: 'EUR', payoutMethod: 'bank', minUsd: '500' });
    await db.insert(feeSchedules).values({ toCode: 'EUR', payoutMethod: 'wallet' });
  });

  it('держит ровно одну ступень без верхней границы', async () => {
    // Обычная уникальность этого не ловит: пустое значение в Postgres не
    // равно другому пустому, и две строки «и всё, что выше» прошли бы
    // обе — с разными ставками и без правила, какая из них верна.
    const scheduleId = await insertSchedule();
    await db.insert(feeScheduleTiers).values({ scheduleId, upToUsd: null, rateBps: 250 });

    await expect(
      db.insert(feeScheduleTiers).values({ scheduleId, upToUsd: null, rateBps: 350 }),
    ).rejects.toThrow(/fee_schedule_tiers_single_top/);
  });

  it('не держит две ступени с одним порогом', async () => {
    const scheduleId = await insertSchedule();
    await db.insert(feeScheduleTiers).values({ scheduleId, upToUsd: '500', fixedUsd: '5' });

    await expect(
      db.insert(feeScheduleTiers).values({ scheduleId, upToUsd: '500', rateBps: 450 }),
    ).rejects.toThrow(/fee_schedule_tiers_threshold/);
  });

  it('не держит двух сеток на одну валюту и способ', async () => {
    await insertSchedule();

    await expect(
      db.insert(feeSchedules).values({ toCode: 'THB', payoutMethod: 'bank' }),
    ).rejects.toThrow(/fee_schedules_target/);
  });

  it('уносит ступени вместе со снятой сеткой', async () => {
    // Ступень без сетки — цена без направления: применить её не к чему,
    // а найти её потом можно только в дампе.
    const scheduleId = await insertSchedule();
    await db.insert(feeScheduleTiers).values({ scheduleId, upToUsd: null, rateBps: 250 });

    await db.delete(feeSchedules).where(eq(feeSchedules.id, scheduleId));

    expect(await db.select().from(feeScheduleTiers)).toHaveLength(0);
  });
});
