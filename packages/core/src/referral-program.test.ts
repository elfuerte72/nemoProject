import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { InvalidInputError } from './errors.js';
import { createCore } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenReferralLines,
  givenReferralTier,
  givenStaff,
} from './test-support.js';
import type { Actor } from './actor.js';

/**
 * Настраиваемая реферальная программа (docs/adr/0021): глубина,
 * уровни, личные ставки и их старшинство.
 *
 * Правила денег — с падающего теста: ставка, по которой начислено,
 * известна до реализации, а проверить её руками значит исполнить
 * заявку через четыре перехода.
 */

const core = createCore({ db: testDatabase() });
let manager: Actor & { type: 'staff' };
let admin: Actor & { type: 'staff' };

async function givenClient(telegramUserId: bigint, referralCode?: string): Promise<string> {
  const { client } = await core.registerClient({
    telegramUserId,
    ...(referralCode === undefined ? {} : { referralCode }),
  });
  return client.referralCode;
}

async function givenCompletedRequest(clientId: bigint, serviceIncome: string): Promise<string> {
  const { request } = await core.submitExchangeRequest(asClient(clientId), {
    kind: 'cash',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100000',
  });
  await core.claimExchangeRequest(manager, request.id);
  await core.confirmExchangeRate(manager, request.id, {
    finalRate: '95',
    paymentInstructions: 'наличными в офисе',
  });
  await core.markPaymentReceived(manager, request.id);
  await core.completeExchangeRequest(manager, request.id, {
    serviceIncome,
    serviceIncomeCode: 'RUB',
  });
  return request.id;
}

/** Цепочка 1 ← 2 ← 3 ← 4 ← 5 ← 6: клиент 6 — реферал пятой линии клиента 1. */
async function givenChain(length: number): Promise<void> {
  let code = await givenClient(1n);
  for (let id = 2n; id <= BigInt(length); id += 1n) {
    code = await givenClient(id, code);
  }
}

async function balance(clientId: bigint): Promise<string> {
  return (await core.getBonusAccount(asClient(clientId))).balance;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  manager = await givenStaff();
  admin = await givenStaff({ role: 'admin' });
});

afterAll(() => closeTestDatabase());

describe('глубина программы', () => {
  it('клиенту показываются линии по глубине программы, а не по всей цепочке', async () => {
    await givenChain(7);

    const first = await core.getBonusAccount(asClient(1n));
    // Цепочка у первого — до пятой линии (клиенты 2..6), но глубина
    // программы две: в кабинете две строки. Сама цепочка закреплена в
    // register-client.test.ts.
    expect(first.lines.map((one) => [one.line, one.count])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    const { notifications } = await core.registerClient({ telegramUserId: 8n, referralCode: first.referralCode });
    expect(notifications.map((one) => one.kind)).toEqual(['referral-joined']);
  });

  it('начисляет по настроенной глубине, даже если цепочка длиннее', async () => {
    await givenReferralLines([500, 200, 100]);
    await givenChain(6);

    await givenCompletedRequest(6n, '1000');

    // Клиент 6 — реферал первой линии для 5, второй для 4, третьей для 3,
    // четвёртой для 2 и пятой для 1. Оплачиваются три.
    expect(await balance(5n)).toBe('50');
    expect(await balance(4n)).toBe('20');
    expect(await balance(3n)).toBe('10');
    expect(await balance(2n)).toBe('0');
    expect(await balance(1n)).toBe('0');
  });

  it('углубление программы после регистрации доходит до старых цепочек', async () => {
    await givenChain(4);
    await core.updateReferralLines(admin, [
      { line: 1, rateBps: 500 },
      { line: 2, rateBps: 200 },
      { line: 3, rateBps: 100 },
    ]);

    await givenCompletedRequest(4n, '1000');

    expect(await balance(1n)).toBe('10');
  });

  it('задаётся администратором списком подряд идущих линий и пишется в журнал', async () => {
    const program = await core.updateReferralLines(admin, [
      { line: 1, rateBps: 700 },
      { line: 2, rateBps: 300 },
      { line: 3, rateBps: 100 },
      { line: 4, rateBps: 50 },
    ]);
    expect(program.depth).toBe(4);
    expect(program.lines.map((one) => one.rateBps)).toEqual([700, 300, 100, 50]);

    const [entry] = await core.listSettingsAuditLog(admin);
    expect(entry).toMatchObject({ subject: 'referral_line_rates' });

    await expect(
      core.updateReferralLines(admin, [{ line: 2, rateBps: 100 }]),
    ).rejects.toThrow(InvalidInputError);
    await expect(core.updateReferralLines(admin, [])).rejects.toThrow(InvalidInputError);
    await expect(
      core.updateReferralLines(admin, [{ line: 1, rateBps: 10_001 }]),
    ).rejects.toThrow(InvalidInputError);
    await expect(
      core.updateReferralLines(manager, [{ line: 1, rateBps: 100 }]),
    ).rejects.toThrow(/forbidden|Только администратор/i);
  });
});

describe('старшинство ставок', () => {
  it('личная ставка выше уровня, уровень выше базовой — по каждой линии отдельно', async () => {
    await givenReferralLines([500, 200]);
    // Уровень с порогом в одного активного реферала: ставка первой
    // линии 800, вторая унаследована базовой.
    await givenReferralTier({ name: 'Серебро', minActiveReferrals: 1, rates: [{ line: 1, rateBps: 800 }] });
    const first = await givenClient(1n);
    const second = await givenClient(2n, first);
    await givenClient(3n, second);
    // Клиент 2 становится активным для клиента 1 первой же заявкой.
    await givenCompletedRequest(2n, '1000');
    await core.setClientReferralRates(admin, 1n, [{ line: 2, rateBps: 400 }]);

    const rates = await core.getBonusAccount(asClient(1n));
    expect(rates.lines.map((one) => [one.line, one.rateBps, one.source])).toEqual([
      [1, 800, 'tier'],
      [2, 400, 'individual'],
    ]);
    expect(rates.tier?.current?.name).toBe('Серебро');

    await givenCompletedRequest(3n, '1000');
    // За заявку клиента 2 — 8% уровня: своей же заявкой он стал активным,
    // и уровень достигнут в момент исполнения. За заявку клиента 3 —
    // вторая линия, личная ставка 4%. Итого 80 + 40.
    expect(await balance(1n)).toBe('120');
  });

  it('уровень считается по активным рефералам первой линии, а не по всем', async () => {
    await givenReferralTier({ name: 'Золото', minActiveReferrals: 2, rates: [{ line: 1, rateBps: 900 }] });
    const first = await givenClient(1n);
    await givenClient(2n, first);
    await givenClient(3n, first);

    const before = await core.getBonusAccount(asClient(1n));
    expect(before.tier?.current).toBeNull();
    expect(before.tier?.next?.name).toBe('Золото');
    expect(before.tier?.activeReferrals).toBe(0);

    await givenCompletedRequest(2n, '1000');
    await givenCompletedRequest(2n, '1000');
    // Один активный реферал с двумя заявками — всё ещё один.
    expect((await core.getBonusAccount(asClient(1n))).tier?.activeReferrals).toBe(1);

    await givenCompletedRequest(3n, '1000');
    const after = await core.getBonusAccount(asClient(1n));
    expect(after.tier?.current?.name).toBe('Золото');
    expect(after.lines[0]).toMatchObject({ line: 1, rateBps: 900, source: 'tier' });
  });

  it('ставка на момент исполнения: прошлые начисления не меняются', async () => {
    const first = await givenClient(1n);
    await givenClient(2n, first);
    await givenCompletedRequest(2n, '1000');
    expect(await balance(1n)).toBe('50');

    await core.setClientReferralRates(admin, 1n, [{ line: 1, rateBps: 1000 }]);
    await core.updateReferralLines(admin, [{ line: 1, rateBps: 900 }]);

    expect(await balance(1n)).toBe('50');
    await givenCompletedRequest(2n, '1000');
    expect(await balance(1n)).toBe('150');
  });
});

describe('уровни и личные ставки администратора', () => {
  it('уровень заводится, правится и удаляется с записью в журнал', async () => {
    const tier = await core.upsertReferralTier(admin, {
      name: 'Серебро',
      minActiveReferrals: 3,
      rates: [{ line: 1, rateBps: 700 }],
    });
    expect(tier).toMatchObject({ name: 'Серебро', minActiveReferrals: 3 });

    const renamed = await core.upsertReferralTier(admin, {
      id: tier.id,
      name: 'Бронза',
      minActiveReferrals: 3,
      rates: [{ line: 1, rateBps: 600 }],
    });
    expect(renamed.id).toBe(tier.id);
    expect((await core.getReferralProgram(admin)).tiers).toEqual([
      expect.objectContaining({ name: 'Бронза', rates: [{ line: 1, rateBps: 600 }] }),
    ]);

    await core.deleteReferralTier(admin, tier.id);
    expect((await core.getReferralProgram(admin)).tiers).toEqual([]);

    const log = await core.listSettingsAuditLog(admin);
    expect(log.map((one) => one.subject)).toEqual([
      'referral_tier',
      'referral_tier',
      'referral_tier',
    ]);
  });

  it('два уровня с одним порогом не заводятся, порог от одного', async () => {
    await core.upsertReferralTier(admin, { name: 'А', minActiveReferrals: 2, rates: [] });
    await expect(
      core.upsertReferralTier(admin, { name: 'Б', minActiveReferrals: 2, rates: [] }),
    ).rejects.toThrow(/порог/i);
    await expect(
      core.upsertReferralTier(admin, { name: 'В', minActiveReferrals: 0, rates: [] }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('личные ставки задаются и снимаются, менеджеру нельзя', async () => {
    await givenClient(1n);
    await core.setClientReferralRates(admin, 1n, [{ line: 1, rateBps: 1000 }]);
    expect((await core.getBonusAccount(asClient(1n))).lines[0]).toMatchObject({
      rateBps: 1000,
      source: 'individual',
    });

    await core.setClientReferralRates(admin, 1n, null);
    expect((await core.getBonusAccount(asClient(1n))).lines[0]).toMatchObject({
      rateBps: 500,
      source: 'base',
    });

    await expect(
      core.setClientReferralRates(manager, 1n, [{ line: 1, rateBps: 1000 }]),
    ).rejects.toThrow(/forbidden|Только администратор/i);
    const [entry] = await core.listSettingsAuditLog(admin);
    expect(entry).toMatchObject({ subject: 'client_referral_rates', subjectId: '1' });
  });
});
