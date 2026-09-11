import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import type { MerchantBreakdowns } from '@nemo/core';
import { Money } from '@nemo/types';
import { analyticsTables } from './analytics-rows';
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
  byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, submitted: 0 })),
  byWeekday: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, submitted: 0 })),
  records: { busiestStep: null, largest: [], fastest: null, slowest: null },
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
          { at: '2026-09-01', submitted: 3, completed: 2, cancelled: 1, turnover: [] },
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
          },
        ],
      }),
    );
    const recipients = tables.find((one) => one.key === 'recipient');
    expect(recipients?.rows[0]?.[0]).toBe('Сбербанк · карта •••• 1111');
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

describe('тексты аналитики набраны человеком', () => {
  it.each(ANALYTICS_HOW_TO.map((item) => [item.title, item] as const))('подсказка «%s»', (_name, item) => {
    expect(slopComplaints(`${item.title}\n${item.detail}`)).toEqual([]);
  });
});
