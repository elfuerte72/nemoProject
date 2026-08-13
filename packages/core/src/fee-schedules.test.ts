import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  createCore,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  type Actor,
  type RatePair,
  type RateQuote,
  type RateSource,
} from './index.js';
import {
  givenCurrency,
  givenCurrencyPair,
  givenFeeSchedule,
  givenServiceSettings,
  givenStaff,
} from './test-support.js';

/**
 * Правка ставок из панели.
 *
 * Ставки — решение о деньгах, и меняет их администратор, а не выкатка.
 * Проверяется здесь ровно то, чего не видно глазом на экране: что
 * негодная сетка отвергается операцией, что сохранённая ставка идёт в
 * следующую же котировку и что погашенная возвращает направление к
 * наценке, а не закрывает его.
 *
 * Числа посчитаны от правила вручную, а не тем же выражением, что в
 * коде.
 */

/** Источник, который котирует ровно перечисленные пары. */
function givenRates(rates: Record<string, string>): RateSource {
  return {
    async quote(pair: RatePair): Promise<RateQuote | null> {
      const rate = rates[`${pair.fromCode}/${pair.toCode}`];
      return rate === undefined
        ? null
        : { rate: rate as RateQuote['rate'], asOf: new Date('2026-08-13T00:00:00Z') };
    },
  };
}

/**
 * Рубль по сотой доллара, бат по тридцать за доллар — числа круглые
 * нарочно.
 *
 * Прямая пара нужна только там, где сетки нет: с сеткой ядро идёт через
 * доллар и у источника её не спрашивает вовсе.
 */
const RATES = { 'RUB/USDT': '0.01', 'USDT/THB': '30', 'RUB/THB': '0.3' };

/** Сетка бата на банк из ТЗ владельца — та, что заводится скриптом. */
const BANK_TIERS = [
  { upToUsd: '500', fixedUsd: '5' },
  { upToUsd: '2000', rateBps: 450 },
  { upToUsd: '5000', rateBps: 350 },
  { upToUsd: null, rateBps: 250 },
];

const db = testDatabase();
const core = createCore({ db, rateSource: givenRates(RATES) });

let admin: Actor & { type: 'staff' };
let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  admin = await givenStaff({ role: 'admin', displayName: 'Владелец' });
  manager = await givenStaff({ role: 'manager' });
});

afterAll(() => closeTestDatabase());

describe('сетки комиссии в панели', () => {
  it('показывает администратору сетку со ступенями по возрастанию', async () => {
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });

    const [schedule] = await core.listFeeSchedules(admin);

    expect(schedule?.toCode).toBe('THB');
    expect(schedule?.payoutMethod).toBe('bank');
    expect(schedule?.isActive).toBe(true);
    expect(schedule?.tiers).toEqual([
      { upToUsd: '500', fixedUsd: '5' },
      { upToUsd: '2000', rateBps: 450 },
      { upToUsd: '5000', rateBps: 350 },
      { upToUsd: null, rateBps: 250 },
    ]);
  });

  it('не показывает и не даёт править менеджеру', async () => {
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });

    await expect(core.listFeeSchedules(manager)).rejects.toThrow(ForbiddenError);
    await expect(
      core.saveFeeSchedule(manager, {
        toCode: 'THB',
        payoutMethod: 'bank',
        tiers: [{ upToUsd: null, rateBps: 100 }],
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('сохранённая ставка идёт в следующую котировку', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    const saved = await core.saveFeeSchedule(admin, {
      toCode: 'THB',
      payoutMethod: 'bank',
      tiers: BANK_TIERS,
    });
    // Заведённая сетка ждёт включения: до него направление считается по
    // наценке, и это проверяется отдельным тестом ниже.
    await core.setFeeScheduleActive(admin, saved.id, true);

    const quote = await core.getQuote({
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '100000',
      payoutMethod: 'bank',
    });

    // 100 000 ₽ — это 1 000 $. Ступень до двух тысяч: 4,5% — 45 $.
    // Остаётся 955 $, по тридцать бат за доллар — 28 650 ฿.
    expect(quote?.toAmount).toBe('28650');
  });

  it('переписывает ступени целиком, а не дописывает к прежним', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    const saved = await core.saveFeeSchedule(admin, {
      toCode: 'THB',
      payoutMethod: 'bank',
      tiers: BANK_TIERS,
    });
    await core.setFeeScheduleActive(admin, saved.id, true);

    await core.saveFeeSchedule(admin, {
      toCode: 'THB',
      payoutMethod: 'bank',
      tiers: [{ upToUsd: null, rateBps: 1000 }],
    });

    const [schedule] = await core.listFeeSchedules(admin);
    expect(schedule?.tiers).toEqual([{ upToUsd: null, rateBps: 1000 }]);

    // Та же тысяча долларов, но ставка теперь 10% — остаётся 900 $,
    // то есть 27 000 ฿.
    const quote = await core.getQuote({
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '100000',
      payoutMethod: 'bank',
    });
    expect(quote?.toAmount).toBe('27000');
  });

  it('погашенная сетка возвращает направление к наценке, а не закрывает его', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'THB' });
    // Наценка в ноль: проверяется отсутствие сетки, а не арифметика
    // наценки, и лишнее слагаемое здесь только мешало бы читать число.
    await givenServiceSettings({ markupBps: 0 });
    const saved = await core.saveFeeSchedule(admin, {
      toCode: 'THB',
      payoutMethod: 'bank',
      tiers: BANK_TIERS,
    });
    await core.setFeeScheduleActive(admin, saved.id, true);

    const off = await core.setFeeScheduleActive(admin, saved.id, false);
    expect(off.isActive).toBe(false);

    const quote = await core.getQuote({
      fromCode: 'RUB',
      toCode: 'THB',
      fromAmount: '100000',
      payoutMethod: 'bank',
    });

    // Без сетки цену назначает наценка: рубль по 0,3 бата, комиссии
    // нет вовсе — 30 000 ฿.
    expect(quote?.toAmount).toBe('30000');
  });

  it('отвергает убывающие пороги', async () => {
    await givenCurrency('THB');

    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'THB',
        payoutMethod: 'bank',
        tiers: [
          { upToUsd: '2000', rateBps: 450 },
          { upToUsd: '500', fixedUsd: '5' },
          { upToUsd: null, rateBps: 250 },
        ],
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает сетку, у которой последняя ступень с верхней границей', async () => {
    await givenCurrency('THB');

    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'THB',
        payoutMethod: 'bank',
        tiers: [
          { upToUsd: '500', fixedUsd: '5' },
          { upToUsd: '2000', rateBps: 450 },
        ],
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает ступень с двумя ставками сразу', async () => {
    await givenCurrency('THB');

    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'THB',
        payoutMethod: 'bank',
        tiers: [{ upToUsd: null, fixedUsd: '5', rateBps: 250 }],
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает ступень без ставки вовсе', async () => {
    await givenCurrency('THB');

    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'THB',
        payoutMethod: 'bank',
        tiers: [{ upToUsd: null }],
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('заводит новую сетку погашенной, а правку действующей не гасит', async () => {
    await givenCurrency('THB');

    const created = await core.saveFeeSchedule(admin, {
      toCode: 'THB',
      payoutMethod: 'bank',
      tiers: BANK_TIERS,
    });

    // Ступени в новой сетке ещё не правили — включённой она меняла бы
    // цену тем, кто в эту минуту считает обмен.
    expect(created.isActive).toBe(false);

    await core.setFeeScheduleActive(admin, created.id, true);
    const saved = await core.saveFeeSchedule(admin, {
      toCode: 'THB',
      payoutMethod: 'bank',
      tiers: [{ upToUsd: null, rateBps: 300 }],
    });
    expect(saved.isActive).toBe(true);
  });

  it('отвергает нулевой и отрицательный порог', async () => {
    await givenCurrency('THB');

    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'THB',
        payoutMethod: 'bank',
        tiers: [
          { upToUsd: '0', fixedUsd: '5' },
          { upToUsd: null, rateBps: 250 },
        ],
      }),
    ).rejects.toThrow(InvalidInputError);

    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'THB',
        payoutMethod: 'bank',
        tiers: [
          { upToUsd: '-500', fixedUsd: '5' },
          { upToUsd: null, rateBps: 250 },
        ],
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает отрицательную фиксированную ставку', async () => {
    await givenCurrency('THB');

    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'THB',
        payoutMethod: 'bank',
        tiers: [{ upToUsd: null, fixedUsd: '-5' }],
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает неизвестный способ выдачи внятной ошибкой', async () => {
    await givenCurrency('THB');

    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'THB',
        // Мимо формы: маршрут такое не пропустит, но операцию зовут не
        // только с экрана, и отвечать она должна отказом, а не разбором
        // схемы наружу.
        payoutMethod: 'sms' as 'bank',
        tiers: [{ upToUsd: null, rateBps: 250 }],
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает пустую сетку', async () => {
    await givenCurrency('THB');

    await expect(
      core.saveFeeSchedule(admin, { toCode: 'THB', payoutMethod: 'bank', tiers: [] }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('отвергает валюту, которой нет в справочнике', async () => {
    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'XXX',
        payoutMethod: 'bank',
        tiers: [{ upToUsd: null, rateBps: 250 }],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('гасит только названную сетку, а не пару целиком', async () => {
    await givenFeeSchedule({ toCode: 'THB', payoutMethod: 'bank', tiers: BANK_TIERS });
    await givenFeeSchedule({
      toCode: 'THB',
      payoutMethod: 'wallet',
      tiers: [{ upToUsd: null, rateBps: 350 }],
    });

    const before = await core.listFeeSchedules(admin);
    const bank = before.find((one) => one.payoutMethod === 'bank');
    await core.setFeeScheduleActive(admin, bank!.id, false);

    const after = await core.listFeeSchedules(admin);
    expect(after.find((one) => one.payoutMethod === 'bank')?.isActive).toBe(false);
    expect(after.find((one) => one.payoutMethod === 'wallet')?.isActive).toBe(true);
  });

  it('не находит сетку по чужому идентификатору', async () => {
    await expect(
      core.setFeeScheduleActive(admin, '00000000-0000-0000-0000-000000000000', false),
    ).rejects.toThrow(NotFoundError);
  });
});
