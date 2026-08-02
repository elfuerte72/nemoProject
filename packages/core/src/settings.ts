import { eq } from 'drizzle-orm';
import { serviceSettings } from '@nemo/db';
import { Money, type Amount } from '@nemo/types';
import type { Executor } from './context.js';

/**
 * Настройки сервиса: ставки реферальных линий, наценка, минимальные
 * суммы и срок жизни неоплаченной заявки.
 *
 * Всё, что определяет экономику, лежит здесь, а не в коде: доходность
 * сервиса — решение администратора, а не константа сборки, и менять её
 * выкаткой значило бы просить разработчика на каждую правку процента.
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
  /** Наценка к котировке в базисных пунктах — одна на весь сервис. */
  readonly markupBps: number;
  /** Минимальная сумма обмена в рублях (`MIN_EXCHANGE_CODE`). */
  readonly minExchangeAmount: Amount;
  /** Сколько заявка ждёт оплаты после выдачи реквизитов, в минутах. */
  readonly unpaidExchangeRequestTtlMinutes: number;
  readonly updatedAt: Date;
}

/**
 * Валюта, в которой задана минимальная сумма обмена.
 *
 * Колонкой не хранится: рубль — фиатная сторона каждого из четырёх
 * направлений, в которых работает сервис, и настройка «в какой валюте
 * минимум» была бы выбором из одного варианта. Когда справочник
 * вырастет за пределы USDT и рубля, валюта станет колонкой.
 */
export const MIN_EXCHANGE_CODE = 'RUB';

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
    markupBps: row.markupBps,
    minExchangeAmount: Money.toAmount(row.minExchangeAmount),
    unpaidExchangeRequestTtlMinutes: row.unpaidExchangeRequestTtlMinutes,
    updatedAt: row.updatedAt,
  };
}
