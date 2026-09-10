import { MAX_REFERRAL_DEPTH, type ReferralLine } from '@nemo/types';
import type { ReferralLineRate, ReferralRateInput, UpsertReferralTierInput } from '@nemo/core';
import { bpsToPercent, isWholeNumber, percentToBps } from './percent';

/**
 * Черновики форм реферальной программы.
 *
 * Проценты на экране, базисные пункты в ядре — как у наценки; пустое
 * поле ставки уровня или личной ставки — «наследует», а не ноль:
 * нулевая ставка — тоже ставка, и её набирают нулём. По этим же
 * правилам гаснет кнопка: отказ ядра после нажатия говорил бы о поле,
 * в котором опечатка, а администратор видит его перед собой.
 */

/** Базовые ставки линий — строкой процентов на поле, по порядку линий. */
export function linesToDrafts(lines: readonly ReferralLineRate[]): string[] {
  return [...lines].sort((a, b) => a.line - b.line).map((one) => bpsToPercent(one.rateBps));
}

/**
 * Поля линий → ставки по порядку. `null`, когда отправлять нечего:
 * пусто, не число, или линий больше, чем оплачивается вообще.
 */
export function draftsToLines(drafts: readonly string[]): ReferralRateInput[] | null {
  if (drafts.length === 0 || drafts.length > MAX_REFERRAL_DEPTH) return null;
  const lines: ReferralRateInput[] = [];
  for (const [index, draft] of drafts.entries()) {
    const rateBps = percentToBps(draft);
    if (rateBps === null) return null;
    lines.push({ line: index + 1, rateBps });
  }
  return lines;
}

export interface TierDraft {
  readonly id?: string | undefined;
  readonly name: string;
  /** Порог активных рефералов — строкой из поля. */
  readonly threshold: string;
  /** Ставка на каждую линию программы; пусто — наследует базовую. */
  readonly rates: readonly string[];
}

/** Черновик уровня → вход операции; `null`, когда кнопке гаснуть. */
export function tierDraftToInput(draft: TierDraft): UpsertReferralTierInput | null {
  const name = draft.name.trim();
  if (name.length === 0 || !isWholeNumber(draft.threshold) || Number(draft.threshold) < 1) {
    return null;
  }
  const rates: ReferralRateInput[] = [];
  for (const [index, value] of draft.rates.entries()) {
    if (value.trim() === '') continue;
    const rateBps = percentToBps(value);
    if (rateBps === null) return null;
    rates.push({ line: (index + 1) as ReferralLine, rateBps });
  }
  return {
    ...(draft.id === undefined ? {} : { id: draft.id }),
    name,
    minActiveReferrals: Number(draft.threshold),
    rates,
  };
}

/**
 * Личные ставки из полей по линиям: все пусты — `null`, «снять все»;
 * опечатка — `undefined`, кнопке гаснуть.
 */
export function individualDraftsToRates(
  drafts: readonly string[],
): ReferralRateInput[] | null | undefined {
  const rates: ReferralRateInput[] = [];
  for (const [index, value] of drafts.entries()) {
    if (value.trim() === '') continue;
    const rateBps = percentToBps(value);
    if (rateBps === null) return undefined;
    rates.push({ line: index + 1, rateBps });
  }
  return rates.length === 0 ? null : rates;
}
