import { eq } from 'drizzle-orm';
import { serviceSettings } from '@nemo/db';
import { Money, type Amount } from '@nemo/types';
import type { Executor } from './context.js';

/**
 * Настройки сервиса: ставки реферальных линий и минимальная сумма
 * вывода.
 *
 * Строка всегда одна и создаётся вместе с таблицей, поэтому чтение не
 * проверяет её существование — отсутствие строки означало бы, что
 * миграция применена не полностью, и молча подставлять значения по
 * умолчанию в этом случае значило бы начислять по неизвестно чьим
 * ставкам.
 */

export interface ServiceSettingsView {
  /** Ставка первой линии в базисных пунктах: 100 bps = 1%. */
  readonly referralLine1Bps: number;
  readonly referralLine2Bps: number;
  readonly minWithdrawalAmount: Amount;
  readonly updatedAt: Date;
}

export async function readServiceSettings(
  executor: Executor,
): Promise<ServiceSettingsView> {
  const [row] = await executor
    .select()
    .from(serviceSettings)
    .where(eq(serviceSettings.id, 1))
    .limit(1);

  if (!row) {
    throw new Error('Настройки сервиса не заведены: миграция применена не полностью');
  }

  return {
    referralLine1Bps: row.referralLine1Bps,
    referralLine2Bps: row.referralLine2Bps,
    minWithdrawalAmount: Money.toAmount(row.minWithdrawalAmount),
    updatedAt: row.updatedAt,
  };
}
