import { Money } from '@nemo/types';

/**
 * Карточка сетки комиссии: набрано ли в ней то, что сохранено.
 *
 * «Включить» включает сетку с сохранёнными ступенями, а не с набранными:
 * включение — отдельное действие ядра, ставок оно не несёт. До 17
 * сентября 2026 новая сетка, у которой поправили числа заготовки и сразу
 * включили, начинала считать клиентам ступенями заготовки, а набранное
 * пропадало вместе с перерисовкой карточки. Сохранять за администратора
 * молча форма не должна — цена меняется только его явным действием, —
 * поэтому при несохранённых ставках «Включить» не включает и говорит,
 * что сначала их надо сохранить. Решает это сравнение здесь.
 */

/** Ступень в том виде, в каком уходит на сохранение и приходит обратно. */
export interface FeeTierInput {
  readonly upToUsd: string | null;
  readonly rateBps?: number | undefined;
  readonly fixedUsd?: string | undefined;
  readonly fixedPayout?: string | undefined;
}

export interface SavedFeeSchedule {
  readonly minUsd: string | null;
  readonly thresholdInclusive: boolean;
  readonly tiers: readonly FeeTierInput[];
}

export interface FeeScheduleForm {
  /** Сырое поле «Минимум, $»: пусто — порога нет. */
  readonly minUsd: string;
  readonly thresholdInclusive: boolean;
  /** `null`, пока ступени не добраны: сохранённые всегда полные. */
  readonly tiers: readonly FeeTierInput[] | null;
}

/**
 * Одно и то же ли число. По значению, а не по тексту: «500.00» в поле и
 * сохранённые «500» — одна цена, и отказ включить из-за нулей в хвосте
 * читался бы как поломка.
 */
function sameAmount(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a?.replace(',', '.').trim() || null;
  const right = b?.replace(',', '.').trim() || null;
  if (left === null || right === null) return left === right;
  const parsedLeft = Money.amountSchema.safeParse(left);
  const parsedRight = Money.amountSchema.safeParse(right);
  if (!parsedLeft.success || !parsedRight.success) return false;
  return Money.compare(parsedLeft.data, parsedRight.data) === 0;
}

function sameTier(a: FeeTierInput, b: FeeTierInput): boolean {
  return (
    sameAmount(a.upToUsd, b.upToUsd) &&
    a.rateBps === b.rateBps &&
    sameAmount(a.fixedUsd, b.fixedUsd) &&
    sameAmount(a.fixedPayout, b.fixedPayout)
  );
}

/** Есть ли в карточке набранное, которого нет в сохранённой сетке. */
export function feeScheduleUnsaved(saved: SavedFeeSchedule, form: FeeScheduleForm): boolean {
  if (form.tiers === null) return true;
  if (form.tiers.length !== saved.tiers.length) return true;
  if (form.thresholdInclusive !== saved.thresholdInclusive) return true;
  if (!sameAmount(form.minUsd, saved.minUsd)) return true;
  return form.tiers.some((tier, index) => !sameTier(tier, saved.tiers[index]!));
}
