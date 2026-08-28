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
const RATES = {
  'RUB/USDT': '0.01',
  'USDT/THB': '30',
  'RUB/THB': '0.3',
  'USDT/EUR': '0.8649',
};

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
    // нет вовсе. Курс при этом округлён до сотых крупной стороной —
    // 3,34 рубля за бат, — и сто тысяч рублей дают 29 940,12 ฿.
    expect(quote?.toAmount).toBe('29940.12');
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

  it('отвергает ступень с двумя фиксами разом', async () => {
    /*
     * Прежний запрет «двух ставок» сужен 17 августа 2026 по формуле
     * владельца («3,3 % и 10 EUR сверху»): доля сочетается с любым
     * фиксом. Бессмысленной осталась ровно пара фиксов — один вычитается
     * до умножения на курс, второй после, и вместе они означали бы, что
     * никто не знает, сколько стоит обмен.
     */
    await givenCurrency('THB');

    await expect(
      core.saveFeeSchedule(admin, {
        toCode: 'THB',
        payoutMethod: 'bank',
        tiers: [{ upToUsd: null, fixedUsd: '5', fixedPayout: '10' }],
      }),
    ).rejects.toThrow(/не оба разом/);
  });

  it('сохраняет и читает минимальную сумму сетки', async () => {
    await givenCurrency('EUR');

    const saved = await core.saveFeeSchedule(admin, {
      toCode: 'EUR',
      payoutMethod: 'bank',
      minUsd: '500',
      tiers: [{ upToUsd: null, rateBps: 230, fixedPayout: '10' }],
    });
    expect(saved.minUsd).toBe('500');

    // Правка без поля минимум снимает: форма шлёт сетку целиком, и
    // оставшееся от прошлого сохранения значение было бы порогом,
    // которого администратор на экране уже не видит.
    const cleared = await core.saveFeeSchedule(admin, {
      toCode: 'EUR',
      payoutMethod: 'bank',
      tiers: [{ upToUsd: null, rateBps: 230, fixedPayout: '10' }],
    });
    expect(cleared.minUsd).toBeNull();
  });

  it('отвергает минимум сетки, который не положительное число', async () => {
    await givenCurrency('EUR');

    for (const minUsd of ['0', '-5', 'сто']) {
      await expect(
        core.saveFeeSchedule(admin, {
          toCode: 'EUR',
          payoutMethod: 'bank',
          minUsd,
          tiers: [{ upToUsd: null, rateBps: 230 }],
        }),
      ).rejects.toThrow(InvalidInputError);
    }
  });

  it('сохраняет и читает ступень «доля + фикс в валюте выдачи»', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'EUR' });
    const saved = await core.saveFeeSchedule(admin, {
      toCode: 'EUR',
      payoutMethod: 'bank',
      tiers: [
        { upToUsd: '2000', rateBps: 330, fixedPayout: '10' },
        { upToUsd: null, rateBps: 230, fixedPayout: '10' },
      ],
    });
    await core.setFeeScheduleActive(admin, saved.id, true);

    // Перечитанная сетка несёт фикс в валюте выдачи, а не теряет его
    // молча: потерянный, он всплыл бы только расхождением цены.
    const [schedule] = await core.listFeeSchedules(admin);
    expect(schedule?.tiers).toEqual([
      { upToUsd: '2000', rateBps: 330, fixedPayout: '10' },
      { upToUsd: null, rateBps: 230, fixedPayout: '10' },
    ]);

    // И считается: 100 000 ₽ — 1 000 $, 3,3% — 33 $, остаток 967 $ по
    // 0,8649 — 836,3583 €, минус десять евро — 826,3583, на двух
    // знаках евро это 826,36.
    const quote = await core.getQuote({
      fromCode: 'RUB',
      toCode: 'EUR',
      fromAmount: '100000',
      payoutMethod: 'bank',
    });
    expect(quote?.toAmount).toBe('826.36');
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

  it('принимает сетку для наличных отдельно от безналичных', async () => {
    await givenCurrency('RUB');

    const cash = await core.saveFeeSchedule(admin, {
      toCode: 'RUB',
      payoutMethod: 'cash',
      tiers: [{ upToUsd: null, rateBps: 300 }],
    });
    const bank = await core.saveFeeSchedule(admin, {
      toCode: 'RUB',
      payoutMethod: 'bank',
      tiers: [{ upToUsd: null, rateBps: 150 }],
    });

    // Наличный обмен стоит сервису другого, чем перевод, и ставка у
    // него своя: одна сетка не подменяет другую.
    expect(cash.id).not.toBe(bank.id);
    const list = await core.listFeeSchedules(admin);
    expect(list.map((one) => one.payoutMethod).sort()).toEqual(['bank', 'cash']);
  });

  it('пишет правку ставок в журнал настроек', async () => {
    await givenCurrency('THB');

    const saved = await core.saveFeeSchedule(admin, {
      toCode: 'THB',
      payoutMethod: 'bank',
      tiers: BANK_TIERS,
    });
    await core.setFeeScheduleActive(admin, saved.id, true);

    const log = await core.listSettingsAuditLog(admin);
    const entries = log.filter((entry) => entry.subject === 'fee_schedule');

    // Вопрос «почему за эту заявку взяли столько» должен иметь ответ, а
    // ставка — единственное в цене, что меняется руками.
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.subjectId === saved.id)).toBe(true);
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
