import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import type { MerchantBreakdowns, MerchantPeriodSummary } from '@nemo/core';
import { Money } from '@nemo/types';
import { analyticsTables, reportRows, summaryTable } from './analytics-rows';
import { ANALYTICS_HOW_TO } from './analytics-texts';

/**
 * Таблицы разрезов: шапка и строки берутся из одного места, и по нему
 * же собирается выгрузка. Два набора колонок — экранный и файловый —
 * разошлись бы при первой правке, и заметил бы это тот, кто сверяет
 * файл с экраном.
 */

const EMPTY_SLICE = { submitted: 0, completed: 0, cancelled: 0, converted: 0, turnover: [] };

const cut = (over: Partial<MerchantBreakdowns> = {}): MerchantBreakdowns => ({
  period: { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-08T00:00:00Z') },
  step: 'day',
  series: [],
  funnel: { stages: [], expired: 0 },
  byDirection: [],
  byPayoutMethod: [],
  byRecipient: [],
  recipientsHidden: 0,
  bySource: [],
  byStaff: [],
  byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, submitted: 0 })),
  byWeekday: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, submitted: 0 })),
  load: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
  recipients: { total: 0, fresh: 0, returning: 0 },
  byCurrency: [],
  medianTicket: [],
  records: {
    busiestStep: null,
    largest: [],
    fastest: null,
    slowest: null,
    bestDay: null,
    medianMinutes: null,
  },
  ...over,
});

describe('таблицы разрезов', () => {
  it('у каждой строки столько же ячеек, сколько в шапке', () => {
    const tables = analyticsTables(
      cut({
        byDirection: [
          {
            fromCode: 'USDT',
            toCode: 'RUB',
            kind: 'electronic',
            submitted: 3,
            completed: 2,
            cancelled: 1,
            converted: 2,
            turnover: [{ code: 'USDT', amount: Money.toAmount('300'), count: 2 }],
          },
        ],
        bySource: [{ source: 'api', ...EMPTY_SLICE, submitted: 3 }],
        series: [
          { at: '2026-09-01', submitted: 3, completed: 2, cancelled: 1, turnover: [], recipients: 2 },
        ],
        funnel: {
          stages: [
            { status: 'completed', count: 2 },
            { status: 'cancelled', count: 1 },
          ],
          expired: 0,
        },
        byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, submitted: hour === 9 ? 3 : 0 })),
        byStaff: [{ userId: 'u1', name: 'Анна', role: 'operator', ...EMPTY_SLICE, submitted: 3 }],
        byCurrency: [
          { code: 'USDT', given: { amount: Money.toAmount('300'), count: 2 }, received: null },
        ],
      }),
    );

    expect(tables).not.toHaveLength(0);
    for (const table of tables) {
      for (const row of table.rows) {
        expect(row).toHaveLength(table.columns.length);
      }
    }
  });

  it('валюты в обороте стоят рядом, а не складываются', () => {
    const [directions] = analyticsTables(
      cut({
        byDirection: [
          {
            fromCode: 'USDT',
            toCode: 'RUB',
            kind: 'electronic',
            submitted: 2,
            completed: 2,
            cancelled: 0,
            converted: 2,
            turnover: [
              { code: 'RUB', amount: Money.toAmount('50000'), count: 1 },
              { code: 'USDT', amount: Money.toAmount('100'), count: 1 },
            ],
          },
        ],
      }),
    );

    // Литералом, а не через `formatByCurrency`: утверждение, собранное
    // той же функцией, что и проверяемое значение, доказывает только
    // то, что функция вызвана дважды.
    expect(directions?.rows[0]).toContain('50\u202f000 RUB · 100 USDT');
    // Одного числа «оборот» в строке нет: складывать валюты нечем.
    expect(directions?.rows[0]?.join(' ')).toMatch(/RUB · .*USDT/u);
  });

  it('источник без отметки назван словами, а не пустой строкой', () => {
    const tables = analyticsTables(
      cut({ bySource: [{ source: null, ...EMPTY_SLICE, submitted: 4 }] }),
    );
    const sources = tables.find((one) => one.key === 'source');
    expect(sources?.rows[0]?.[0]).toBe('Не записан');
  });

  it('получатель описан тем, что о нём видно без расшифровки', () => {
    const tables = analyticsTables(
      cut({
        byRecipient: [
          {
            kind: 'card',
            bankName: 'Сбербанк',
            phone: null,
            cardLast4: '1111',
            network: null,
            addressHint: null,
            holderName: null,
            accountLast4: null,
            qrHint: null,
            promptpayIdType: null,
            alipayAccount: null,
            ...EMPTY_SLICE,
            submitted: 2,
            lastSubmittedAt: new Date('2026-09-05T20:30:00Z'),
            fresh: true,
          },
        ],
      }),
      { offsetMinutes: 7 * 60 },
    );
    const recipients = tables.find((one) => one.key === 'recipient');
    expect(recipients?.rows[0]?.[0]).toBe('Сбербанк · карта •••• 1111');
    // Новый — словом, последняя заявка — днём по часам того, кто смотрит:
    // в Бангкоке 20:30 UTC пятого — это уже шестое.
    expect(recipients?.rows[0]?.slice(1, 3)).toEqual(['да', '2026-09-06']);
  });

  it('у сотрудника роль и средний чек по каждой валюте', () => {
    const tables = analyticsTables(
      cut({
        byStaff: [
          {
            userId: 'u1',
            name: 'Анна',
            role: 'operator',
            submitted: 3,
            completed: 2,
            cancelled: 0,
            converted: 2,
            turnover: [{ code: 'USDT', amount: Money.toAmount('300'), count: 2 }],
          },
          { userId: null, name: null, role: null, ...EMPTY_SLICE, submitted: 1 },
        ],
      }),
    );
    const staff = tables.find((one) => one.key === 'staff');
    expect(staff?.rows[0]?.slice(0, 2)).toEqual(['Анна', 'Оператор']);
    expect(staff?.rows[0]?.[6]).toBe('150 USDT');
    expect(staff?.rows[1]?.slice(0, 2)).toEqual(['Через ключ API', '—']);
  });

  it('валюта — с обеих сторон, и пустая сторона прочерком, а не нулём', () => {
    const tables = analyticsTables(
      cut({
        byCurrency: [
          { code: 'THB', given: null, received: { amount: Money.toAmount('13900'), count: 1 } },
        ],
      }),
    );
    const currencies = tables.find((one) => one.key === 'currency');
    expect(currencies?.rows[0]).toEqual(['THB', '—', '13\u202f900 THB', 1]);
    expect(currencies?.marks).toEqual([['THB']]);
  });

  it('отчёт целиком — все таблицы по порядку, каждая под своим названием', () => {
    const tables = analyticsTables(
      cut({ bySource: [{ source: 'api', ...EMPTY_SLICE, submitted: 1 }] }),
    );
    const rows = reportRows(tables, ['Аналитика', '2026-09-01 — 2026-09-07']);
    expect(rows[0]).toEqual(['Аналитика', '2026-09-01 — 2026-09-07']);
    expect(rows).toContainEqual(['Источники']);
    expect(rows).toContainEqual(['API', 1, 0, 0, '0 %', '—']);
  });

  it('пустой разрез таблицей не показывается', () => {
    expect(analyticsTables(cut()).map((one) => one.key)).toEqual([]);
  });

  it('часы и дни недели показываются, как только есть хоть одна заявка', () => {
    const tables = analyticsTables(
      cut({
        byHour: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          submitted: hour === 21 ? 1 : 0,
        })),
      }),
    );
    const hours = tables.find((one) => one.key === 'hour');
    expect(hours?.rows).toHaveLength(24);
    expect(hours?.rows[21]).toEqual(['21:00', 1]);
  });
});

describe('показатели одной таблицей', () => {
  const summary = (over: Partial<MerchantPeriodSummary> = {}): MerchantPeriodSummary => ({
    submitted: 0,
    completed: 0,
    cancelled: 0,
    open: 0,
    conversion: null,
    turnover: [],
    averageMinutesToComplete: null,
    apiCalls: { total: 0, failed: 0 },
    webhookDeliveries: { total: 0, failed: 0 },
    ...over,
  });

  /*
   * Плитки, сроки и рекорды — в отчёт тоже: «отчёт целиком», в котором
   * нет оборота, — не отчёт. Каждая строка — «сейчас» и «было», как на
   * плитке, а где прошлого периода у числа нет, там прочерк.
   */
  it('несёт плитки, сроки и рекорды — сейчас и было', () => {
    const table = summaryTable(
      {
        current: summary({
          submitted: 14,
          completed: 10,
          turnover: [{ code: 'USDT', amount: Money.toAmount('6200'), count: 4 }],
          apiCalls: { total: 66, failed: 22 },
        }),
        previous: summary({ submitted: 3 }),
      },
      cut({ recipients: { total: 4, fresh: 3, returning: 1 } }),
      { days: 90, paceDays: 90, mine: false },
    );
    expect(table.key).toBe('summary');
    for (const row of table.rows) expect(row).toHaveLength(table.columns.length);
    expect(table.rows).toContainEqual(['Подано', 14, 3]);
    expect(table.rows).toContainEqual(['Оборот', '6 200 USDT', '—']);
    expect(table.rows).toContainEqual(['Средний чек', '1 550 USDT', '—']);
    expect(table.rows).toContainEqual(['Получателей', '4 (впервые 3, вернулись 1)', '—']);
    expect(table.rows).toContainEqual(['Вызовов API', '66 (с ошибкой 22)', '0']);
    expect(table.rows).toContainEqual(['Оценка на месяц', '2 066,67 USDT', '—']);
  });

  it('в отборе «только мои» вызовов и доставок нет: ключ ничей', () => {
    const table = summaryTable({ current: summary(), previous: summary() }, cut(), {
      days: 30,
      paceDays: 30,
      mine: true,
    });
    expect(table.rows.map((row) => row[0])).not.toContain('Вызовов API');
    expect(table.rows.map((row) => row[0])).not.toContain('Доставок вебхуков');
  });
});

describe('тексты аналитики набраны человеком', () => {
  it.each(ANALYTICS_HOW_TO.map((item) => [item.title, item] as const))('подсказка «%s»', (_name, item) => {
    expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
  });
});
