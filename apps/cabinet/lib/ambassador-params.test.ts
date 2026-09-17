import { describe, expect, it } from 'vitest';
import { InvalidInputError, NotFoundError } from '@nemo/core';
import { resolvePeriod } from '@nemo/ui/period';
import { readForPeriod, readPeopleQuery } from './ambassador-params';

/**
 * Параметры адреса кабинета амбассадора.
 *
 * Адрес правит кто угодно, и страница аварии на опечатку в нём — худший
 * из ответов. До 17 сентября 2026 `/ambassador/people?line=9` и
 * `?offset=1e300` отвечали пятисотым, а период длиннее года, набранный в
 * полях «С / По», ронял обзор.
 */
describe('список «Мои люди» из адреса', () => {
  it('линия — только та, что бывает; иначе все линии', () => {
    expect(readPeopleQuery({ line: '2' }).line).toBe(2);
    expect(readPeopleQuery({ line: '9' }).line).toBeUndefined();
    expect(readPeopleQuery({ line: '0' }).line).toBeUndefined();
    expect(readPeopleQuery({ line: '1.5' }).line).toBeUndefined();
    expect(readPeopleQuery({ line: 'первая' }).line).toBeUndefined();
    expect(readPeopleQuery({}).line).toBeUndefined();
  });

  it('смещение — целое, какое база примет; иначе первая страница', () => {
    expect(readPeopleQuery({ offset: '50' }).offset).toBe(50);
    expect(readPeopleQuery({ offset: '1e300' }).offset).toBe(0);
    expect(readPeopleQuery({ offset: '-1' }).offset).toBe(0);
    expect(readPeopleQuery({ offset: '2.5' }).offset).toBe(0);
    expect(readPeopleQuery({ offset: 'abc' }).offset).toBe(0);
    expect(readPeopleQuery({ offset: ['100', '50'] }).offset).toBe(100);
    expect(readPeopleQuery({}).offset).toBe(0);
  });
});

describe('сводка за период из адреса', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const asked = resolvePeriod({ period: 'custom', from: '2025-01-01', to: '2026-09-17' }, now, 0);
  const fallback = resolvePeriod({ period: '30d' }, now, 0);

  it('принятый ядром период читается как есть', async () => {
    const result = await readForPeriod(asked, fallback, async (period) => period.key);
    expect(result).toEqual({ period: asked, data: 'custom', refusal: null });
  });

  it('отказ ядра по периоду — слова и числа за период по умолчанию', async () => {
    const read = async (period: typeof asked) => {
      if (period.key === 'custom') throw new InvalidInputError('Период — не длиннее года');
      return period.key;
    };
    expect(await readForPeriod(asked, fallback, read)).toEqual({
      period: fallback,
      data: '30d',
      refusal: 'Период — не длиннее года',
    });
  });

  /*
   * Ядро заводит хук запуска в своём бандле, и класс ошибки у страницы
   * другой: узнаётся отказ по коду (`lib/core-errors.test.ts`).
   */
  it('отказ узнаётся по коду, а не по классу', async () => {
    const foreign = Object.assign(new Error('Период — не длиннее года'), { code: 'invalid-input' });
    const result = await readForPeriod(asked, fallback, async (period) => {
      if (period.key === 'custom') throw foreign;
      return period.key;
    });
    expect(result.refusal).toBe('Период — не длиннее года');
  });

  it('прочие ошибки не подменяются: страница аварии честнее выдуманного объяснения', async () => {
    const broken = new Error('база не ответила');
    await expect(
      readForPeriod(asked, fallback, async () => {
        throw broken;
      }),
    ).rejects.toBe(broken);
    await expect(
      readForPeriod(asked, fallback, async () => {
        throw new NotFoundError('нет');
      }),
    ).rejects.toThrow('нет');
  });
});
