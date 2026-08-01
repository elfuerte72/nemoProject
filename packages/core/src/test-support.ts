import { eq } from 'drizzle-orm';
import { currencies, currencyPairs, staff } from '@nemo/db';
import { testDatabase } from '@nemo/db/testing';
import type { ExchangeKind, StaffRole } from '@nemo/types';
import type { Actor } from './actor.js';

/**
 * Подготовка данных для тестов.
 *
 * Фикстуры пишутся в базу напрямую, потому что заводить справочник
 * валют и сотрудников — работа администратора из отдельных тикетов, и
 * ждать её значило бы не проверять то, что уже написано. Проверяемое
 * поведение при этом всегда идёт через операции: напрямую здесь только
 * то, что ставит сцену.
 */

const db = testDatabase();

export async function givenCurrency(
  code: string,
  options: { decimals?: number; kind?: 'fiat' | 'crypto'; isActive?: boolean } = {},
): Promise<void> {
  await db
    .insert(currencies)
    .values({
      code,
      decimals: options.decimals ?? 2,
      kind: options.kind ?? 'fiat',
      isActive: options.isActive ?? true,
    })
    .onConflictDoNothing();
}

export async function givenCurrencyPair(options: {
  fromCode: string;
  toCode: string;
  kind?: ExchangeKind;
  markupBps?: number;
  isActive?: boolean;
}): Promise<void> {
  await givenCurrency(options.fromCode, { kind: 'crypto', decimals: 18 });
  await givenCurrency(options.toCode);
  await db.insert(currencyPairs).values({
    fromCode: options.fromCode,
    toCode: options.toCode,
    kind: options.kind ?? 'electronic',
    markupBps: options.markupBps ?? 100,
    isActive: options.isActive ?? true,
  });
}

let staffCounter = 0n;

/** Сотрудник и `Actor`, от лица которого идут операции админки. */
export async function givenStaff(
  options: { displayName?: string; role?: StaffRole; telegramUserId?: bigint } = {},
): Promise<Actor & { type: 'staff' }> {
  const role = options.role ?? 'manager';
  staffCounter += 1n;
  const [row] = await db
    .insert(staff)
    .values({
      telegramUserId: options.telegramUserId ?? 900_000n + staffCounter,
      displayName: options.displayName ?? 'Менеджер',
      role,
    })
    .returning();
  return { type: 'staff', staffId: row!.id, role };
}

/** Увольнение сотрудника. Управление доступом — работа из тикета 14. */
export async function disableStaff(staffId: string): Promise<void> {
  await db.update(staff).set({ isActive: false }).where(eq(staff.id, staffId));
}

export function asClient(telegramUserId: bigint): Actor {
  return { type: 'client', telegramUserId };
}
