import { and, asc, eq, sql } from 'drizzle-orm';
import { feeScheduleTiers, feeSchedules } from '@nemo/db';
import { Money, type FeeTier, type PayoutMethod } from '@nemo/types';
import type { Executor } from './context.js';

/**
 * Сетка комиссии для валюты и способа выдачи — или её отсутствие.
 *
 * Пусто означает «этому направлению цену назначает наценка сервиса», а
 * не «обмен невозможен»: сетки владелец присылает по одной, письмом на
 * направление, и до письма всё считается по-старому. Два правила цены
 * разом — решение, а не переходное состояние: у обмена USDT на рубли
 * своя экономика, и ступени бата туда не переносятся.
 *
 * Погашенная сетка тоже читается пустой: администратор гасит её, когда
 * цена по ней стала убыточной, и направление возвращается к наценке —
 * не закрывается вовсе.
 */
export async function readFeeSchedule(
  executor: Executor,
  toCode: string,
  payoutMethod: PayoutMethod,
): Promise<readonly FeeTier[] | null> {
  const rows = await executor
    .select({
      upToUsd: feeScheduleTiers.upToUsd,
      fixedUsd: feeScheduleTiers.fixedUsd,
      rateBps: feeScheduleTiers.rateBps,
    })
    .from(feeScheduleTiers)
    .innerJoin(feeSchedules, eq(feeScheduleTiers.scheduleId, feeSchedules.id))
    .where(
      and(
        eq(feeSchedules.toCode, toCode),
        eq(feeSchedules.payoutMethod, payoutMethod),
        eq(feeSchedules.isActive, true),
      ),
    )
    // Ступени по возрастанию порога, последняя — та, что без границы.
    // Порядок задаёт цену: считающий берёт первую подходящую, и строка
    // «и всё, что выше», оказавшаяся первой, сделала бы ставку одной на
    // все суммы.
    .orderBy(sql`${feeScheduleTiers.upToUsd} asc nulls last`, asc(feeScheduleTiers.id));

  if (rows.length === 0) return null;

  return rows.map((row) => ({
    upToUsd: row.upToUsd === null ? null : Money.toAmount(row.upToUsd),
    ...(row.fixedUsd === null ? {} : { fixedUsd: Money.toAmount(row.fixedUsd) }),
    ...(row.rateBps === null ? {} : { rateBps: row.rateBps }),
  }));
}
