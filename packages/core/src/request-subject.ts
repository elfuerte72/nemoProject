import { inArray } from 'drizzle-orm';
import { clientRequisites, type exchangeRequests, type withdrawalRequests } from '@nemo/db';
import { Money } from '@nemo/types';
import type { CoreConfig } from './context.js';
import type { NewRequestSubject, PayoutHint } from './notifications.js';

/**
 * Заявка в том виде, в каком о ней сообщают сотруднику.
 *
 * Собирается здесь, а не в каждом месте, откуда уходит уведомление:
 * о новой заявке говорит рассылка, о забытой — напоминание, и одна и та
 * же заявка описывалась бы двумя наборами полей, расходящимися при
 * первой правке. Запись клиента — видом и банком, без номера: номер
 * открывают в панели, с записью в журнал доступа.
 */

export type Transaction = Parameters<Parameters<CoreConfig['db']['transaction']>[0]>[0];
type ExchangeRow = typeof exchangeRequests.$inferSelect;
type WithdrawalRow = typeof withdrawalRequests.$inferSelect;

/** Вид и банк записей по их номерам — одним запросом на все заявки прогона. */
export async function payoutHintsOf(
  tx: Transaction,
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, PayoutHint>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();

  const rows = await tx
    .select({
      id: clientRequisites.id,
      kind: clientRequisites.kind,
      bankName: clientRequisites.bankName,
      network: clientRequisites.network,
    })
    .from(clientRequisites)
    .where(inArray(clientRequisites.id, wanted));

  return new Map(
    rows.map((row) => [row.id, { kind: row.kind, bankName: row.bankName, network: row.network }]),
  );
}

export function exchangeSubject(
  row: ExchangeRow,
  hints: ReadonlyMap<string, PayoutHint>,
): Extract<NewRequestSubject, { kind: 'exchange' }> {
  return {
    kind: 'exchange',
    id: row.id,
    fromAmount: Money.toAmount(row.fromAmount),
    fromCode: row.fromCode,
    toCode: row.toCode,
    isCash: row.kind === 'cash',
    toAmount: row.toAmount === null ? null : Money.toAmount(row.toAmount),
    rate: row.requestRate === null ? null : Money.toAmount(row.requestRate),
    payout: (row.requisitesId !== null && hints.get(row.requisitesId)) || null,
  };
}

export function withdrawalSubject(
  row: WithdrawalRow,
  hints: ReadonlyMap<string, PayoutHint>,
): Extract<NewRequestSubject, { kind: 'withdrawal' }> {
  return {
    kind: 'withdrawal',
    id: row.id,
    amount: Money.toAmount(row.amount),
    method: row.method,
    payout: (row.requisitesId !== null && hints.get(row.requisitesId)) || null,
  };
}
