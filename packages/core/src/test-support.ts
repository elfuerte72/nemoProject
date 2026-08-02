import { eq } from 'drizzle-orm';
import { currencies, currencyPairs, serviceSettings, staff, transferNetworks } from '@nemo/db';
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

/**
 * Что известно о валюте.
 *
 * Род валюты — не украшение фикстуры: от него зависит, какой реквизит
 * подходит заявке, и объявлять рубль криптовалютой ради краткости
 * значило бы проверять правило на данных, которых не бывает.
 */
const KNOWN_CURRENCIES: Record<string, { decimals: number; kind: 'fiat' | 'crypto' }> = {
  RUB: { decimals: 2, kind: 'fiat' },
  EUR: { decimals: 2, kind: 'fiat' },
  USDT: { decimals: 6, kind: 'crypto' },
  BTC: { decimals: 8, kind: 'crypto' },
};

export async function givenCurrency(
  code: string,
  options: { decimals?: number; kind?: 'fiat' | 'crypto'; isActive?: boolean } = {},
): Promise<void> {
  const known = KNOWN_CURRENCIES[code] ?? { decimals: 2, kind: 'fiat' as const };
  await db
    .insert(currencies)
    .values({
      code,
      decimals: options.decimals ?? known.decimals,
      kind: options.kind ?? known.kind,
      isActive: options.isActive ?? true,
    })
    .onConflictDoNothing();
}

export async function givenCurrencyPair(options: {
  fromCode: string;
  toCode: string;
  kind?: ExchangeKind;
  isActive?: boolean;
}): Promise<void> {
  await givenCurrency(options.fromCode);
  await givenCurrency(options.toCode);
  await db.insert(currencyPairs).values({
    fromCode: options.fromCode,
    toCode: options.toCode,
    kind: options.kind ?? 'electronic',
    isActive: options.isActive ?? true,
  });
}

/**
 * Сеть перевода в справочнике. Наполняет его скрипт развёртывания, а не
 * операция ядра, — фикстура делает то же самое напрямую.
 */
export async function givenNetwork(
  code: string,
  options: { isActive?: boolean } = {},
): Promise<void> {
  await db
    .insert(transferNetworks)
    .values({ code, isActive: options.isActive ?? true })
    .onConflictDoUpdate({
      target: transferNetworks.code,
      set: { isActive: options.isActive ?? true },
    });
}

/**
 * Экономика сервиса: наценка, минимумы, срок жизни заявки.
 *
 * Строка настроек уже есть — её создаёт очистка базы со значениями по
 * умолчанию, — поэтому фикстура правит, а не вставляет. Через операцию
 * администратора это делать не нужно: тесту курса администратор не
 * нужен, а обходить его собственную проверку прав фикстура и не может.
 */
export async function givenServiceSettings(options: {
  markupBps?: number;
  minExchangeAmount?: string;
  unpaidExchangeRequestTtlMinutes?: number;
}): Promise<void> {
  await db.update(serviceSettings).set(options).where(eq(serviceSettings.id, 1));
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
