import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, InvalidInputError, NotFoundError } from './index.js';
import { asClient, givenCurrencyPair } from './test-support.js';

/**
 * Подача заявки на обмен.
 *
 * Курс на этом шаге не называется: у наличных его вообще нет до
 * разговора с менеджером, а у электронных переводов он справочный.
 * Заявка — это запрос, а не обмен по зафиксированной цене.
 */

const core = createCore({ db: testDatabase() });

/** Куда отправлять деньги. Для электронного перевода без этого никак. */
let requisitesId: string;

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await core.registerClient({ telegramUserId: 100n });
  // Телефон вместо карты: шифровать нечего, а значит и ключ не нужен —
  // проверяются здесь правила подачи, а не хранение номеров.
  const requisites = await core.saveRequisites(asClient(100n), { phone: '+79990000000' });
  requisitesId = requisites.id;
});

afterAll(() => closeTestDatabase());

describe('поданная заявка', () => {
  it('ждёт менеджера в состоянии «новая»', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId,
    });

    expect(request.status).toBe('new');
    expect(request.finalRate).toBeNull();
  });

  it('сохраняет сумму криптовалюты до последнего знака', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      // Восемнадцать знаков: один wei. Через число такая сумма
      // потеряла бы точность задолго до последнего знака.
      fromAmount: '1.000000000000000001',
      requisitesId,
    });

    const [stored] = await core.listExchangeRequests(asClient(100n));

    expect(request.fromAmount).toBe('1.000000000000000001');
    expect(stored!.fromAmount).toBe('1.000000000000000001');
  });

  it('показывает круглую сумму без хвоста нулей', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId,
    });

    expect(request.fromAmount).toBe('100');
  });

  it('подтверждается клиенту сообщением в боте', async () => {
    const { notifications } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
    });

    expect(notifications).toEqual([
      expect.objectContaining({ kind: 'exchange-request-status', to: 100n, status: 'new' }),
    ]);
  });
});

describe('реквизиты при подаче', () => {
  it('обязательны для электронного перевода: деньги некуда отправить', async () => {
    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не нужны для наличных: их клиент получает на руки', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
    });

    expect(request.status).toBe('new');
  });

  it('должны быть действующими: заменённые в заявку не принимаются', async () => {
    await core.saveRequisites(asClient(100n), { phone: '+79991111111' });

    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
        requisitesId,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('проверка заявки', () => {
  it('отвергает нулевую сумму', async () => {
    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '0',
        requisitesId,
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает отрицательную сумму', async () => {
    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '-1',
        requisitesId,
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает направление, которого нет в справочнике', async () => {
    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'EUR',
        fromAmount: '100',
        requisitesId,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('отвергает отключённое направление', async () => {
    await givenCurrencyPair({
      fromCode: 'BTC',
      toCode: 'RUB',
      kind: 'electronic',
      isActive: false,
    });

    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'BTC',
        toCode: 'RUB',
        fromAmount: '1',
        requisitesId,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('различает наличные и электронный перевод как разные направления', async () => {
    await givenCurrencyPair({ fromCode: 'BTC', toCode: 'RUB', kind: 'electronic' });

    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'cash',
        fromCode: 'BTC',
        toCode: 'RUB',
        fromAmount: '1',
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('список заявок клиента', () => {
  it('показывает заявки от новых к старым', async () => {
    const first = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId,
    });
    const second = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '200',
    });

    const list = await core.listExchangeRequests(asClient(100n));

    expect(list.map((request) => request.id)).toEqual([second.request.id, first.request.id]);
  });

  it('не показывает заявки других клиентов', async () => {
    await core.registerClient({ telegramUserId: 200n });
    await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId,
    });

    const list = await core.listExchangeRequests(asClient(200n));

    expect(list).toEqual([]);
  });

  it('не отдаёт заявку клиента тому, кто её не подавал', async () => {
    await core.registerClient({ telegramUserId: 200n });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId,
    });

    await expect(core.getExchangeRequest(asClient(200n), request.id)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('не отдаётся сотруднику через клиентскую операцию', async () => {
    await expect(
      core.listExchangeRequests({ type: 'staff', staffId: crypto.randomUUID(), role: 'manager' }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('справочник направлений', () => {
  it('показывает только действующие направления', async () => {
    await givenCurrencyPair({
      fromCode: 'BTC',
      toCode: 'RUB',
      kind: 'electronic',
      isActive: false,
    });

    const pairs = await core.listCurrencyPairs();

    // Внутри одной пары валют электронный перевод идёт перед наличными:
    // это основной способ, и переставлять его вниз по алфавиту незачем.
    expect(pairs.map((pair) => `${pair.fromCode}/${pair.toCode}:${pair.kind}`)).toEqual([
      'USDT/RUB:electronic',
      'USDT/RUB:cash',
    ]);
  });
});
