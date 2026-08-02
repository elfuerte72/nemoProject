import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  createCore,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  type RateQuote,
  type RateSource,
} from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenNetwork,
  givenServiceSettings,
} from './test-support.js';

/**
 * Подача заявки на обмен.
 *
 * Курс на этом шаге не называется: у наличных его вообще нет до
 * разговора с менеджером, а у электронных переводов он справочный.
 * Заявка — это запрос, а не обмен по зафиксированной цене.
 */

const keys = generateRequisiteKeyPair();
const core = createCore({ db: testDatabase(), requisites: { publicKey: keys.publicKey } });

/**
 * Куда отправлять деньги. Для электронного перевода без этого никак, и
 * запись должна подходить валюте получения: рубли приходят по телефону
 * или на карту, USDT — на кошелёк.
 */
let requisitesId: string;
let walletId: string;

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await core.registerClient({ telegramUserId: 100n });
  await givenNetwork('TRC20');
  // Телефон вместо карты: шифровать нечего, и проверяются здесь правила
  // подачи, а не хранение номеров.
  const requisites = await core.saveRequisites(asClient(100n), {
    kind: 'phone',
    bankName: 'Сбербанк',
    phone: '+79990000000',
  });
  requisitesId = requisites.id;
  const wallet = await core.saveRequisites(asClient(100n), {
    kind: 'wallet',
    network: 'TRC20',
    address: 'TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e',
  });
  walletId = wallet.id;
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

  it('не устаревают от того, что клиент завёл ещё одни', async () => {
    // Записи больше не сменяют друг друга: карта, телефон и кошелёк —
    // разные способы получения, и клиент хранит их сколько нужно.
    await core.saveRequisites(asClient(100n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79991111111',
    });

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId,
    });

    expect(request.status).toBe('new');
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

/**
 * Минимальная сумма обмена задана в рублях: при наценке в пару
 * процентов мелкий обмен не покрывает комиссию сети, которую платит
 * сервис. Поэтому порог сравнивается с рублёвой стороной заявки, а не с
 * суммой подачи как она есть — 3000 USDT и 3000 ₽ это разные деньги.
 */
describe('минимальная сумма обмена', () => {
  /** Источник, отвечающий одной котировкой на любую пару. */
  function givenRateSource(rate: string): RateSource {
    return {
      async quote(): Promise<RateQuote> {
        return { rate: rate as RateQuote['rate'], asOf: new Date('2026-01-01T00:00:00Z') };
      },
    };
  }

  beforeEach(async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' });
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'cash' });
    await givenServiceSettings({ minExchangeAmount: '3000' });
  });

  it('отвергает заявку, отдающую меньше минимума в рублях', async () => {
    await expect(
      core.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'RUB',
        toCode: 'USDT',
        fromAmount: '2999',
        requisitesId: walletId,
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('принимает заявку ровно на минимум', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'RUB',
      toCode: 'USDT',
      fromAmount: '3000',
      requisitesId: walletId,
    });

    expect(request.status).toBe('new');
  });

  it('считает рублёвую сторону по курсу, когда рубли получают, а не отдают', async () => {
    const withRate = createCore({ db: testDatabase(), rateSource: givenRateSource('100') });
    await givenServiceSettings({ markupBps: 0 });

    // 25 USDT по курсу 100 — 2500 ₽, ниже порога в 3000 ₽.
    await expect(
      withRate.submitExchangeRequest(asClient(100n), {
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '25',
        requisitesId,
      }),
    ).rejects.toThrow(InvalidInputError);

    // 30 USDT — ровно 3000 ₽.
    const { request } = await withRate.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '30',
      requisitesId,
    });
    expect(request.status).toBe('new');
  });

  it('не проверяется, когда рублёвой стороны не посчитать: курс назовёт менеджер', async () => {
    // Наличные идут без котировки вовсе, и отказ по порогу означал бы
    // отказ по числу, которого у сервиса в этот момент нет.
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1',
    });

    expect(request.status).toBe('new');
  });

  it('не проверяется при молчании источника котировок', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '1',
      requisitesId,
    });

    expect(request.status).toBe('new');
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

describe('условия обмена', () => {
  it('перечисляют только действующие направления', async () => {
    await givenCurrencyPair({
      fromCode: 'BTC',
      toCode: 'RUB',
      kind: 'electronic',
      isActive: false,
    });

    const { pairs } = await core.getExchangeTerms();

    // Внутри одной пары валют электронный перевод идёт перед наличными:
    // это основной способ, и переставлять его вниз по алфавиту незачем.
    expect(pairs.map((pair) => `${pair.fromCode}/${pair.toCode}:${pair.kind}`)).toEqual([
      'USDT/RUB:electronic',
      'USDT/RUB:cash',
    ]);
  });

  it('называют минимальную сумму обмена: клиент узнаёт её до подачи', async () => {
    await givenServiceSettings({ minExchangeAmount: '5000' });

    const terms = await core.getExchangeTerms();

    expect(terms).toMatchObject({ minAmount: '5000', minAmountCode: 'RUB' });
  });
});
