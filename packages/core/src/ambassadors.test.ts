import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { ForbiddenError, NotFoundError } from './errors.js';
import { createCore } from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';
import type { Actor } from './actor.js';

/**
 * Амбассадор — клиент с отметкой: человек с аудиторией, которого сервис
 * позвал в программу поимённо. Своей сущности у него нет намеренно —
 * приводит он своей реферальной ссылкой, баллы копятся на его же счёте,
 * и вторая цепочка рефералов рядом с первой означала бы два счёта одних
 * и тех же денег.
 *
 * Проверяется здесь то, чем отметка отличается от строки в таблице:
 * заведение поднимает клиента, если его ещё нет; снятие закрывает вход,
 * но не трогает начисленного; вход решает ядро, а не маршрут.
 */

const core = createCore({ db: testDatabase() });
let admin: Actor & { type: 'staff' };
let manager: Actor & { type: 'staff' };

/**
 * Исполненная заявка приведённого — тем же путём, каким она проходит в
 * жизни: подача, курс, оплата, исполнение с доходом. Начисление
 * рефереру делает ядро, и в счёт амбассадора оно попадает так же, как
 * попадёт на проде.
 */
async function givenCompletedRequest(clientId: bigint, serviceIncome: string): Promise<void> {
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
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  admin = await givenStaff({ role: 'admin' });
  manager = await givenStaff();
});
afterAll(() => closeTestDatabase());

describe('заведение амбассадора', () => {
  it('заводит клиента, которого ещё нет, и выдаёт ему реферальную ссылку', async () => {
    // Блогер мог никогда не открывать Mini App, а ссылка нужна ему в
    // день заведения — иначе звать в программу нечем.
    const added = await core.addAmbassador(admin, {
      telegramUserId: 500n,
      title: 'Канал «Пхукет за рубль»',
      note: 'договорились на звонке 10 сентября',
    });

    expect(added.clientId).toBe(500n);
    expect(added.title).toBe('Канал «Пхукет за рубль»');
    expect(added.revokedAt).toBeNull();

    const codes = await core.listReferralCodes(asClient(500n));
    expect(codes.length).toBeGreaterThan(0);
    expect(codes[0]!.code).toMatch(/\S/);
  });

  it('не заводит клиента заново и не трогает того, кто уже приходил', async () => {
    await core.registerClient({ telegramUserId: 501n, username: 'blogger' });
    const before = await core.listReferralCodes(asClient(501n));

    await core.addAmbassador(admin, { telegramUserId: 501n, title: 'Блогер' });

    const after = await core.listReferralCodes(asClient(501n));
    expect(after.map((one) => one.code)).toEqual(before.map((one) => one.code));
  });

  it('дважды одного не заводит', async () => {
    await core.addAmbassador(admin, { telegramUserId: 502n, title: 'Первый раз' });
    await expect(
      core.addAmbassador(admin, { telegramUserId: 502n, title: 'Второй раз' }),
    ).rejects.toThrow(/уже/i);
  });

  it('требует подписи и отказывает менеджеру', async () => {
    const manager = await givenStaff();
    await expect(
      core.addAmbassador(manager, { telegramUserId: 503n, title: 'Нельзя' }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      core.addAmbassador(admin, { telegramUserId: 503n, title: '   ' }),
    ).rejects.toThrow(/подпиш/i);
  });

  it('пишет в журнал настроек, кого позвали и кто позвал', async () => {
    await core.addAmbassador(admin, { telegramUserId: 504n, title: 'Канал' });
    const log = await core.listSettingsAuditLog(admin, 10);
    expect(log.some((row) => row.subject === 'ambassador' && row.subjectId === '504')).toBe(true);
  });
});

describe('вход амбассадора', () => {
  it('пускает заведённого и называет его подписью', async () => {
    await core.addAmbassador(admin, { telegramUserId: 510n, title: 'Канал «Пхукет»' });

    const session = await core.signInAmbassador(510n);
    expect(session).toMatchObject({ clientId: 510n, title: 'Канал «Пхукет»' });
  });

  it('не пускает того, у кого отметки нет', async () => {
    // Подпись Telegram говорит «аккаунтом владеет тот, кто нажал
    // кнопку», и не больше: право войти даёт отметка.
    await core.registerClient({ telegramUserId: 511n });
    await expect(core.signInAmbassador(511n)).rejects.toThrow(ForbiddenError);
    await expect(core.signInAmbassador(9_999n)).rejects.toThrow(ForbiddenError);
  });

  it('перестаёт пускать снятого и пускает восстановленного', async () => {
    await core.addAmbassador(admin, { telegramUserId: 512n, title: 'Канал' });
    await core.revokeAmbassador(admin, 512n);

    await expect(core.signInAmbassador(512n)).rejects.toThrow(ForbiddenError);

    await core.restoreAmbassador(admin, 512n);
    await expect(core.signInAmbassador(512n)).resolves.toMatchObject({ clientId: 512n });
  });

  it('снятие не отнимает начисленного', async () => {
    await core.addAmbassador(admin, { telegramUserId: 513n, title: 'Канал' });
    await core.adjustBonus(admin, 513n, { amount: '500', comment: 'за приведённых' });

    await core.revokeAmbassador(admin, 513n);

    const account = await core.getBonusAccount(asClient(513n));
    expect(account.balance).toBe('500');
  });

  it('снимает и восстанавливает только администратор и только заведённого', async () => {
    const manager = await givenStaff();
    await core.addAmbassador(admin, { telegramUserId: 514n, title: 'Канал' });

    await expect(core.revokeAmbassador(manager, 514n)).rejects.toThrow(ForbiddenError);
    await expect(core.revokeAmbassador(admin, 9_999n)).rejects.toThrow(NotFoundError);
    await expect(core.restoreAmbassador(admin, 9_999n)).rejects.toThrow(NotFoundError);
  });
});

describe('список амбассадоров', () => {
  it('показывает подпись, кто завёл, приведённых по линиям и начисленное', async () => {
    await core.addAmbassador(admin, { telegramUserId: 520n, title: 'Канал «Пхукет»' });
    const codes = await core.listReferralCodes(asClient(520n));
    // Приведённый первой линией и приведённый им же — второй.
    await core.registerClient({ telegramUserId: 521n, referralCode: codes[0]!.code });
    const second = await core.listReferralCodes(asClient(521n));
    await core.registerClient({ telegramUserId: 522n, referralCode: second[0]!.code });
    // Заявка приведённого первой линии: 5 % от дохода в 2 400 — это 120.
    await givenCompletedRequest(521n, '2400');
    // Правка баллов руками — не заработок программы, и в «начислено»
    // она не попадает: этим же правилом считает счёт клиента.
    await core.adjustBonus(admin, 520n, { amount: '80', comment: 'компенсация' });

    const list = await core.listAmbassadors(admin);
    const row = list.find((one) => one.clientId === 520n);

    expect(row).toBeDefined();
    expect(row!.title).toBe('Канал «Пхукет»');
    expect(row!.createdBy).toBe(admin.staffId);
    expect(row!.referredByLine[0]).toMatchObject({ line: 1, count: 1 });
    expect(row!.referredByLine[1]).toMatchObject({ line: 2, count: 1 });
    expect(row!.accrued).toBe('120');
    expect(row!.signedInAt).toBeNull();
  });

  it('помнит, входил ли амбассадор хоть раз', async () => {
    await core.addAmbassador(admin, { telegramUserId: 523n, title: 'Канал' });
    await core.signInAmbassador(523n);

    const list = await core.listAmbassadors(admin);
    expect(list.find((one) => one.clientId === 523n)!.signedInAt).toBeInstanceOf(Date);
  });

  it('ищет по подписи и по идентификатору, показывает снятых', async () => {
    await core.addAmbassador(admin, { telegramUserId: 524n, title: 'Канал «Пхукет»' });
    await core.addAmbassador(admin, { telegramUserId: 525n, title: 'Чат «Бангкок»' });
    await core.revokeAmbassador(admin, 525n);

    expect((await core.listAmbassadors(admin, { query: 'пхукет' })).map((one) => one.clientId)).toEqual([
      524n,
    ]);
    expect((await core.listAmbassadors(admin, { query: '525' })).map((one) => one.clientId)).toEqual([
      525n,
    ]);
    const all = await core.listAmbassadors(admin);
    expect(all.find((one) => one.clientId === 525n)!.revokedAt).toBeInstanceOf(Date);
  });

  it('число сверх bigint — пустой список, а не отказ базы', async () => {
    // Ни тридцать цифр, ни девятнадцать сверх предела `bigint` не
    // должны уходить в запрос: человек просто ошибся при наборе.
    await expect(core.listAmbassadors(admin, { query: '9'.repeat(30) })).resolves.toEqual([]);
    await expect(
      core.listAmbassadors(admin, { query: '9999999999999999999' }),
    ).resolves.toEqual([]);
  });

  it('список — администратору', async () => {
    const manager = await givenStaff();
    await expect(core.listAmbassadors(manager)).rejects.toThrow(ForbiddenError);
  });
});
