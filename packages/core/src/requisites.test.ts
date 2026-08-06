import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { clientRequisites } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, InvalidInputError, NotFoundError } from './index.js';
import { asClient, givenCurrencyPair, givenNetwork } from './test-support.js';

/**
 * Реквизиты клиента — куда сервис отправляет деньги.
 *
 * Запись описывает один способ получения целиком: перевод по телефону,
 * на карту или на кошелёк. Проверяется здесь именно это — что неполной
 * записи не существует и что открытого номера в базе нет, — потому что
 * защищает клиента только второе, а первое защищает его деньги от
 * заявки, которую нельзя исполнить.
 */

const keys = generateRequisiteKeyPair();
const db = testDatabase();
const core = createCore({ db, requisites: { publicKey: keys.publicKey } });

/** Номер сходится по контрольной цифре: иначе его отвергнет сама операция. */
const CARD = '4276 3800 1234 5679';
const ADDRESS = 'TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e';

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' });
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenNetwork('TRC20');
  await core.registerClient({ telegramUserId: 100n });
});

afterAll(() => closeTestDatabase());

describe('перевод на карту', () => {
  it('показывает клиенту только последние четыре цифры', async () => {
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Тинькофф',
      cardNumber: CARD,
    });

    expect(saved.cardLast4).toBe('5679');
    expect(JSON.stringify(saved)).not.toContain('4276');
  });

  it('не оставляет открытого номера в базе', async () => {
    await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Тинькофф',
      cardNumber: CARD,
    });

    const [row] = await db.select().from(clientRequisites);

    expect(row!.cardSealed).toBeInstanceOf(Buffer);
    expect(row!.cardSealed!.toString('utf8')).not.toContain('4276');
    expect(row!.cardSealed!.toString('utf8')).not.toContain('12345678');
  });

  it('не сохраняется без банка', async () => {
    await expect(
      core.saveRequisites(asClient(100n), {
        kind: 'card',
        bankName: '  ',
        cardNumber: CARD,
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает номер короче четырёх цифр', async () => {
    await expect(
      core.saveRequisites(asClient(100n), {
        kind: 'card',
        bankName: 'Тинькофф',
        cardNumber: '123',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает номер с переставленными цифрами', async () => {
    // Тот же номер, но две соседние цифры поменялись местами. Формально
    // это непустая строка нужной длины — и без контрольной суммы такая
    // запись сохранилась бы, а перевод по ней ушёл бы в никуда.
    await expect(
      core.saveRequisites(asClient(100n), {
        kind: 'card',
        bankName: 'Тинькофф',
        cardNumber: '4276 3800 1234 5697',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не сохраняется там, где нет ключа шифрования', async () => {
    const withoutKey = createCore({ db });

    await expect(
      withoutKey.saveRequisites(asClient(100n), {
        kind: 'card',
        bankName: 'Тинькофф',
        cardNumber: CARD,
      }),
    ).rejects.toThrow(/ключ/i);
  });
});

describe('перевод по номеру телефона', () => {
  it('требует банк и телефон', async () => {
    await expect(
      core.saveRequisites(asClient(100n), { kind: 'phone', bankName: 'Сбербанк', phone: '' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('оставляет телефон открытым: по нему менеджер и отправляет перевод', async () => {
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });

    expect(saved.phone).toBe('+79990000000');
    expect(saved.cardLast4).toBeNull();
  });

  it('отвергает номер, в котором не хватает цифр', async () => {
    await expect(
      core.saveRequisites(asClient(100n), {
        kind: 'phone',
        bankName: 'Сбербанк',
        phone: '+7999000',
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});

describe('перевод на кошелёк', () => {
  it('показывает клиенту только края адреса', async () => {
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'wallet',
      network: 'TRC20',
      address: ADDRESS,
    });

    expect(saved.network).toBe('TRC20');
    // Четыре знака с начала и четыре с конца — посчитано по самой
    // строке выше, а не тем же кодом, что собирает подсказку.
    expect(saved.addressHint).toBe('TQmX…aU6e');
    expect(JSON.stringify(saved)).not.toContain(ADDRESS);
  });

  it('не оставляет открытого адреса в базе', async () => {
    await core.saveRequisites(asClient(100n), {
      kind: 'wallet',
      network: 'TRC20',
      address: ADDRESS,
    });

    const [row] = await db.select().from(clientRequisites);

    expect(row!.addressSealed).toBeInstanceOf(Buffer);
    expect(row!.addressSealed!.toString('utf8')).not.toContain(ADDRESS);
  });

  it('не сохраняется без адреса', async () => {
    await expect(
      core.saveRequisites(asClient(100n), { kind: 'wallet', network: 'TRC20', address: ' ' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает адрес, скопированный не целиком', async () => {
    // Хвост потерялся при копировании — длина не сошлась. Такой адрес
    // непуст и сеть у него та самая, но перевод по нему уйдёт в никуда.
    await expect(
      core.saveRequisites(asClient(100n), {
        kind: 'wallet',
        network: 'TRC20',
        address: ADDRESS.slice(0, 30),
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает адрес чужой сети', async () => {
    await expect(
      core.saveRequisites(asClient(100n), {
        kind: 'wallet',
        network: 'TRC20',
        address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не сохраняется в сети, которой сервис не знает', async () => {
    await expect(
      core.saveRequisites(asClient(100n), {
        kind: 'wallet',
        network: 'ERC20',
        address: ADDRESS,
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не сохраняется в сети, выключенной администратором', async () => {
    await givenNetwork('TON', { isActive: false });

    await expect(
      core.saveRequisites(asClient(100n), {
        kind: 'wallet',
        network: 'TON',
        address: ADDRESS,
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});

describe('список реквизитов', () => {
  it('хранит столько записей, сколько клиенту нужно', async () => {
    await core.saveRequisites(asClient(100n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });
    await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Тинькофф',
      cardNumber: CARD,
    });
    await core.saveRequisites(asClient(100n), {
      kind: 'wallet',
      network: 'TRC20',
      address: ADDRESS,
    });

    const saved = await core.listRequisites(asClient(100n));

    expect(saved.map((one) => one.kind).sort()).toEqual(['card', 'phone', 'wallet']);
  });

  it('пуст, пока клиент ничего не сохранил', async () => {
    expect(await core.listRequisites(asClient(100n))).toEqual([]);
  });

  it('помечает кошелёк в погашенной сети недоступным, но не прячет его', async () => {
    // Убрать запись совсем значило бы, что она пропала сама: сеть
    // включат обратно, а до тех пор клиент может её удалить.
    await core.saveRequisites(asClient(100n), {
      kind: 'wallet',
      network: 'TRC20',
      address: ADDRESS,
    });
    await givenNetwork('TRC20', { isActive: false });

    const [wallet] = await core.listRequisites(asClient(100n));

    expect(wallet?.network).toBe('TRC20');
    expect(wallet?.isAvailable).toBe(false);
  });

  it('оставляет доступными карту и телефон: сети у них нет', async () => {
    await core.saveRequisites(asClient(100n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });

    const [saved] = await core.listRequisites(asClient(100n));

    expect(saved?.isAvailable).toBe(true);
  });

  it('не отдаёт записи другого клиента', async () => {
    await core.registerClient({ telegramUserId: 200n });
    await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Тинькофф',
      cardNumber: CARD,
    });

    expect(await core.listRequisites(asClient(200n))).toEqual([]);
  });

  it('не возвращает ни номера карты, ни адреса целиком', async () => {
    await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Тинькофф',
      cardNumber: CARD,
    });
    await core.saveRequisites(asClient(100n), {
      kind: 'wallet',
      network: 'TRC20',
      address: ADDRESS,
    });

    const dump = JSON.stringify(await core.listRequisites(asClient(100n)));

    expect(dump).not.toContain('42763800');
    expect(dump).not.toContain(ADDRESS);
  });
});

describe('удаление реквизита', () => {
  it('убирает запись из списка', async () => {
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Тинькофф',
      cardNumber: CARD,
    });

    await core.archiveRequisites(asClient(100n), saved.id);

    expect(await core.listRequisites(asClient(100n))).toEqual([]);
  });

  it('оставляет её в ранее поданной заявке: куда ушли деньги, видно и потом', async () => {
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Тинькофф',
      cardNumber: CARD,
    });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId: saved.id,
    });

    await core.archiveRequisites(asClient(100n), saved.id);

    const stored = await core.getExchangeRequest(asClient(100n), request.id);
    expect(stored.id).toBe(request.id);
    expect(await db.select().from(clientRequisites)).toHaveLength(1);
  });

  it('не даётся чужому клиенту', async () => {
    await core.registerClient({ telegramUserId: 200n });
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Тинькофф',
      cardNumber: CARD,
    });

    await expect(core.archiveRequisites(asClient(200n), saved.id)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('подбор реквизита при подаче заявки', () => {
  async function givenCard(): Promise<string> {
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'card',
      bankName: 'Тинькофф',
      cardNumber: CARD,
    });
    return saved.id;
  }

  async function givenWallet(network = 'TRC20'): Promise<string> {
    const saved = await core.saveRequisites(asClient(100n), {
      kind: 'wallet',
      network,
      address: ADDRESS,
    });
    return saved.id;
  }

  it('принимает карту, когда клиент получает рубли', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId: await givenCard(),
    });

    expect(request.status).toBe('new');
  });

  it('отвергает карту, когда клиент получает USDT', async () => {
    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'RUB',
        toCode: 'USDT',
        fromAmount: '10000',
        requisitesId: await givenCard(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('принимает кошелёк, когда клиент получает USDT', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '10000',
      requisitesId: await givenWallet(),
    });

    expect(request.status).toBe('new');
  });

  it('отвергает кошелёк, когда клиент получает рубли', async () => {
    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        requisitesId: await givenWallet(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает кошелёк в сети, выключенной после сохранения записи', async () => {
    const wallet = await givenWallet();
    await givenNetwork('TRC20', { isActive: false });

    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'RUB',
        toCode: 'USDT',
        fromAmount: '10000',
        requisitesId: wallet,
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает удалённую запись', async () => {
    const card = await givenCard();
    await core.archiveRequisites(asClient(100n), card);

    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        requisitesId: card,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('отвергает чужую запись', async () => {
    await core.registerClient({ telegramUserId: 200n });
    const foreign = await givenCard();

    await expect(
      core.submitExchangeRequest(asClient(200n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        requisitesId: foreign,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('не спрашивает реквизитов у наличной заявки', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
    });

    expect(request.status).toBe('new');
  });

  it('не принимает реквизитов у наличной заявки: деньги выдаются на руки', async () => {
    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'cash',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        requisitesId: await givenCard(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});
