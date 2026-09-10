import { eq } from 'drizzle-orm';
import { serviceSettings } from '@nemo/db';
import { Money, type Amount } from '@nemo/types';
import { requireStaff, type Actor } from './actor.js';
import type { Executor } from './context.js';
import { InvalidInputError } from './errors.js';

/**
 * Настройки сервиса: наценка, минимальные суммы и срок жизни
 * неоплаченной заявки. Ставки реферальных линий с 8 сентября 2026 —
 * в `referral-program.ts`: их стало до пяти, и число колонок задавало
 * бы глубину программы.
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
  readonly minWithdrawalAmount: Amount;
  /** Наценка к котировке в базисных пунктах — одна на весь сервис. */
  readonly markupBps: number;
  /** Минимальная сумма обмена в USDT (`MIN_EXCHANGE_CODE`). */
  readonly minExchangeAmount: Amount;
  /** Сколько заявка ждёт оплаты после выдачи реквизитов, в минутах. */
  readonly unpaidExchangeRequestTtlMinutes: number;
  /** Сколько ответов консьерж даёт одному клиенту за сутки. Ноль — выключен. */
  readonly conciergeRepliesPerClientDaily: number;
  /** Сколько ответов консьерж даёт за сутки всему сервису. */
  readonly conciergeRepliesDaily: number;
  /**
   * Ник, на который в кабинете мерчанта ведёт «Поддержка». Пусто —
   * ссылки нет: выдуманный ник вёл бы в пустой чат.
   */
  readonly merchantSupportUsername: string | null;
  readonly updatedAt: Date;
}

/**
 * Валюта, в которой задана минимальная сумма обмена.
 *
 * USDT, а не рубль. Пока сервис торговал одной парой, рубль стоял по
 * одну сторону каждого направления и порог работал везде. Со списком
 * валют выдачи так стоит USDT: клиент отдаёт его в каждом направлении
 * либо получает — и порог снова накрывает справочник целиком, не
 * усложняя правило.
 *
 * Колонкой по-прежнему не хранится: настройка «в какой валюте минимум»
 * была бы выбором из одного варианта. Колонкой она станет тогда, когда
 * сервис начнёт принимать не только USDT.
 */
export const MIN_EXCHANGE_CODE = 'USDT';

/**
 * Наценка — сотруднику.
 *
 * Остальная экономика остаётся администратору, а это число нужно
 * менеджеру: по нему панель подсказывает доход по заявке, который он
 * иначе считает в уме. Секрета в нём нет — клиент видит ту же величину
 * в котировке (`QuoteView.markupBps`), — а отдавать ради одного числа
 * весь раздел настроек значило бы открыть менеджеру ставки линий и
 * минимумы, которых он не назначает.
 */
export async function getServiceMarkupBps(
  ctx: { readonly db: Executor },
  actor: Actor,
): Promise<number> {
  requireStaff(actor);
  const { markupBps } = await readServiceSettings(ctx.db);
  return markupBps;
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
    minWithdrawalAmount: Money.toAmount(row.minWithdrawalAmount),
    markupBps: row.markupBps,
    minExchangeAmount: Money.toAmount(row.minExchangeAmount),
    unpaidExchangeRequestTtlMinutes: row.unpaidExchangeRequestTtlMinutes,
    conciergeRepliesPerClientDaily: row.conciergeRepliesPerClientDaily,
    conciergeRepliesDaily: row.conciergeRepliesDaily,
    merchantSupportUsername: row.merchantSupportUsername,
    updatedAt: row.updatedAt,
  };
}

/**
 * Ставка в базисных пунктах — целая и не выше 100%: ставка выше отдавала
 * бы рефереру больше, чем сервис заработал. Одна проверка на настройки
 * сервиса и на реферальную программу.
 */
export function requireBps(value: number, subject: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new InvalidInputError(
      `${subject}: ожидаются целые базисные пункты от 0 до 10000 (10000 = 100%)`,
    );
  }
  return value;
}
