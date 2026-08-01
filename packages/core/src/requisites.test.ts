import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { clientRequisites } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, InvalidInputError, NotFoundError } from './index.js';
import { asClient, givenCurrencyPair } from './test-support.js';

/**
 * Реквизиты клиента — куда сервис отправляет деньги.
 *
 * Номер карты в системе есть, но прочитать его клиентское приложение не
 * может: там нет приватного ключа (docs/adr/0002). Проверяется здесь
 * именно это — не «шифрование вызвано», а «открытого номера в базе
 * нет», потому что защищает клиента только второе.
 */

const keys = generateRequisiteKeyPair();
const db = testDatabase();
const core = createCore({ db, requisites: { publicKey: keys.publicKey } });

const CARD = '4276 3800 1234 5678';

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await core.registerClient({ telegramUserId: 100n });
});

afterAll(() => closeTestDatabase());

describe('сохранённые реквизиты', () => {
  it('показывают клиенту только последние четыре цифры', async () => {
    const saved = await core.saveRequisites(asClient(100n), {
      bankName: 'Тинькофф',
      phone: '+79990000000',
      cardNumber: CARD,
    });

    expect(saved.cardLast4).toBe('5678');
    expect(JSON.stringify(saved)).not.toContain('4276');
  });

  it('не оставляют открытого номера в базе', async () => {
    await core.saveRequisites(asClient(100n), { cardNumber: CARD });

    const [row] = await db.select().from(clientRequisites);

    expect(row!.cardSealed).toBeInstanceOf(Buffer);
    expect(row!.cardSealed!.toString('utf8')).not.toContain('4276');
    expect(row!.cardSealed!.toString('utf8')).not.toContain('12345678');
  });

  it('отдаются клиенту как текущие', async () => {
    await core.saveRequisites(asClient(100n), { bankName: 'Тинькофф', cardNumber: CARD });

    const current = await core.getRequisites(asClient(100n));

    expect(current?.bankName).toBe('Тинькофф');
    expect(current?.cardLast4).toBe('5678');
  });

  it('отсутствуют, пока клиент их не сохранил', async () => {
    expect(await core.getRequisites(asClient(100n))).toBeNull();
  });
});

describe('замена реквизитов', () => {
  it('делает текущими новые, а не прежние', async () => {
    await core.saveRequisites(asClient(100n), { cardNumber: '4276380012345678' });

    const replaced = await core.saveRequisites(asClient(100n), {
      cardNumber: '5536910011112222',
    });
    const current = await core.getRequisites(asClient(100n));

    expect(current?.id).toBe(replaced.id);
    expect(current?.cardLast4).toBe('2222');
  });

  it('сохраняет прежние в архиве: на них ссылаются прошлые заявки', async () => {
    const first = await core.saveRequisites(asClient(100n), { cardNumber: CARD });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId: first.id,
    });

    await core.saveRequisites(asClient(100n), { cardNumber: '5536910011112222' });

    const stored = await core.getExchangeRequest(asClient(100n), request.id);
    expect(stored.id).toBe(request.id);
    expect(await db.select().from(clientRequisites)).toHaveLength(2);
  });
});

describe('чужие реквизиты', () => {
  it('не отдаются другому клиенту', async () => {
    await core.registerClient({ telegramUserId: 200n });
    await core.saveRequisites(asClient(100n), { cardNumber: CARD });

    expect(await core.getRequisites(asClient(200n))).toBeNull();
  });

  it('не принимаются в чужую заявку', async () => {
    await core.registerClient({ telegramUserId: 200n });
    const foreign = await core.saveRequisites(asClient(100n), { cardNumber: CARD });

    await expect(
      core.submitExchangeRequest(asClient(200n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        requisitesId: foreign.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('проверка реквизитов', () => {
  it('отвергает номер карты короче четырёх цифр', async () => {
    await expect(
      core.saveRequisites(asClient(100n), { cardNumber: '123' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает реквизиты, в которых нечего сохранять', async () => {
    await expect(core.saveRequisites(asClient(100n), {})).rejects.toThrow(InvalidInputError);
  });

  it('не сохраняет карту там, где нет ключа шифрования', async () => {
    const withoutKey = createCore({ db });

    await expect(
      withoutKey.saveRequisites(asClient(100n), { cardNumber: CARD }),
    ).rejects.toThrow(/ключ/i);
  });
});
