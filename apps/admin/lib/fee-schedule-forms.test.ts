import { describe, expect, it } from 'vitest';
import { feeScheduleUnsaved, type SavedFeeSchedule } from './fee-schedule-forms';

/**
 * Несохранённые ставки у карточки сетки.
 *
 * «Включить» включает сохранённую сетку, а не набранную: до 17 сентября
 * 2026 администратор правил числа новой сетки, жал «Включить», не нажав
 * «Сохранить ставки», — и клиенты получали ступени заготовки, а
 * набранное пропадало. Теперь «Включить» при несохранённых ставках не
 * включает, и решает это сравнение набранного с сохранённым: по числу, а
 * не по тексту поля, иначе «4,50» против сохранённых «4.5» не давало бы
 * включить сетку, в которой ничего не менялось.
 */

const SAVED: SavedFeeSchedule = {
  minUsd: '500',
  thresholdInclusive: true,
  tiers: [
    { upToUsd: '500', rateBps: 450, fixedUsd: '5' },
    { upToUsd: '2000', rateBps: 450 },
    { upToUsd: null, rateBps: 250 },
  ],
};

const SAME = {
  minUsd: '500',
  thresholdInclusive: true,
  tiers: [
    { upToUsd: '500', rateBps: 450, fixedUsd: '5' },
    { upToUsd: '2000', rateBps: 450 },
    { upToUsd: null, rateBps: 250 },
  ],
};

describe('несохранённые ставки сетки', () => {
  it('нет, пока набранное совпадает с сохранённым', () => {
    expect(feeScheduleUnsaved(SAVED, SAME)).toBe(false);
  });

  it('нет, если число то же, а записано иначе', () => {
    expect(
      feeScheduleUnsaved(SAVED, {
        ...SAME,
        minUsd: ' 500.00 ',
        tiers: [
          { upToUsd: '500.0', rateBps: 450, fixedUsd: '5.00' },
          { upToUsd: '2000', rateBps: 450 },
          { upToUsd: null, rateBps: 250 },
        ],
      }),
    ).toBe(false);
  });

  it('есть, когда поправлена ставка, порог или фикс', () => {
    const tiers = SAME.tiers;
    expect(
      feeScheduleUnsaved(SAVED, { ...SAME, tiers: [tiers[0]!, { ...tiers[1]!, rateBps: 400 }, tiers[2]!] }),
    ).toBe(true);
    expect(
      feeScheduleUnsaved(SAVED, { ...SAME, tiers: [{ ...tiers[0]!, upToUsd: '600' }, tiers[1]!, tiers[2]!] }),
    ).toBe(true);
    expect(
      feeScheduleUnsaved(SAVED, { ...SAME, tiers: [{ ...tiers[0]!, fixedUsd: '10' }, tiers[1]!, tiers[2]!] }),
    ).toBe(true);
  });

  it('есть, когда фикс переехал в валюту выдачи с тем же числом', () => {
    const [first, ...rest] = SAME.tiers;
    expect(
      feeScheduleUnsaved(SAVED, {
        ...SAME,
        tiers: [{ upToUsd: first!.upToUsd, rateBps: 450, fixedPayout: '5' }, ...rest],
      }),
    ).toBe(true);
  });

  it('есть, когда ступень добавлена или убрана', () => {
    expect(feeScheduleUnsaved(SAVED, { ...SAME, tiers: SAME.tiers.slice(1) })).toBe(true);
    expect(
      feeScheduleUnsaved(SAVED, {
        ...SAME,
        tiers: [SAME.tiers[0]!, { upToUsd: '1000', rateBps: 450 }, ...SAME.tiers.slice(1)],
      }),
    ).toBe(true);
  });

  it('есть, пока ступени не добраны: сохранённые всегда полные', () => {
    expect(feeScheduleUnsaved(SAVED, { ...SAME, tiers: null })).toBe(true);
  });

  it('есть, когда поменялся минимум или знак порога', () => {
    expect(feeScheduleUnsaved(SAVED, { ...SAME, minUsd: '' })).toBe(true);
    expect(feeScheduleUnsaved(SAVED, { ...SAME, minUsd: '5оо' })).toBe(true);
    expect(feeScheduleUnsaved({ ...SAVED, minUsd: null }, { ...SAME, minUsd: '  ' })).toBe(false);
    expect(feeScheduleUnsaved(SAVED, { ...SAME, thresholdInclusive: false })).toBe(true);
  });
});
