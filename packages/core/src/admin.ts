import { asc, desc, eq, sql } from 'drizzle-orm';
import { generateTotpSecret, seal } from '@nemo/crypto';
import { currencyPairs, serviceSettings, settingsAuditLog, staff } from '@nemo/db';
import { Money, type ExchangeKind, type StaffRole } from '@nemo/types';
import { requireAdmin, type Actor } from './actor.js';
import { requirePublicKey, type CoreConfig, type Executor } from './context.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import { readServiceSettings, type ServiceSettingsView } from './settings.js';

/**
 * Управление сотрудниками и экономикой сервиса.
 *
 * Раздел администратора и только его: менеджер — тот, чей доступ здесь
 * настраивается и чьи обращения к чужим номерам карт здесь видны.
 *
 * Ставки линий и наценки — правила, а не суммы, и они меняются со
 * временем. Прошлые начисления от смены ставки не пересчитываются:
 * ставка, по которой начислено, хранится в самой строке движения
 * (`referral-accruals.ts`), и переписывать её задним числом означало бы
 * менять условия сделки, которая давно закрыта.
 *
 * Каждое изменение записывается в журнал. Вопрос «почему за эту сделку
 * начислили столько» должен иметь ответ, а не догадку.
 */

export interface StaffView {
  readonly id: string;
  readonly telegramUserId: bigint;
  readonly displayName: string;
  readonly role: StaffRole;
  readonly isActive: boolean;
  /** Ложь, пока администратор не выдал второй фактор: войти нельзя. */
  readonly hasSecondFactor: boolean;
  readonly createdAt: Date;
}

/**
 * Секрет второго фактора показывается ровно один раз — тому
 * администратору, который его выдал. Он передаёт его сотруднику лично;
 * второй показ не нужен, а хранить секрет в открытом виде негде.
 */
export interface StaffEnrollment {
  readonly staff: StaffView;
  readonly enrollmentSecret: string;
}

export interface AddStaffInput {
  readonly telegramUserId: bigint;
  readonly displayName: string;
  readonly role?: StaffRole | undefined;
}

export interface CurrencyPairAdminView {
  readonly id: string;
  readonly fromCode: string;
  readonly toCode: string;
  readonly kind: ExchangeKind;
  readonly markupBps: number;
  readonly isActive: boolean;
}

export interface SettingsAuditEntry {
  readonly id: string;
  readonly staffId: string;
  readonly staffName: string;
  readonly subject: string;
  readonly subjectId: string | null;
  readonly changes: unknown;
  readonly createdAt: Date;
}

type StaffRow = typeof staff.$inferSelect;

function toStaffView(row: StaffRow): StaffView {
  return {
    id: row.id,
    telegramUserId: row.telegramUserId,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive,
    hasSecondFactor: row.totpSecretSealed !== null,
    createdAt: row.createdAt,
  };
}

async function record(
  executor: Executor,
  staffId: string,
  subject: string,
  subjectId: string | null,
  changes: Record<string, unknown>,
): Promise<void> {
  await executor.insert(settingsAuditLog).values({ staffId, subject, subjectId, changes });
}

/**
 * Секрет второго фактора шифруется тем же ключом, что и реквизиты: оба
 * читаются только в админке, и заводить для них два разных ключа значило
 * бы удвоить число мест, где ключ можно потерять.
 */
function sealedSecret(ctx: CoreConfig): { secret: string; sealed: Buffer } {
  const secret = generateTotpSecret();
  return { secret, sealed: seal(requirePublicKey(ctx), secret) };
}

export async function listStaff(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly StaffView[]> {
  requireAdmin(actor);
  const rows = await ctx.db.select().from(staff).orderBy(asc(staff.createdAt));
  return rows.map(toStaffView);
}

export async function addStaff(
  ctx: CoreConfig,
  actor: Actor,
  input: AddStaffInput,
): Promise<StaffEnrollment> {
  const admin = requireAdmin(actor);
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new InvalidInputError('Укажите имя сотрудника');
  }

  const { secret, sealed } = sealedSecret(ctx);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(staff)
      .values({
        telegramUserId: input.telegramUserId,
        displayName,
        role: input.role ?? 'manager',
        totpSecretSealed: sealed,
      })
      .onConflictDoNothing({ target: staff.telegramUserId })
      .returning();

    if (!row) {
      throw new ConflictError('Сотрудник с таким Telegram уже заведён');
    }

    await record(tx, admin.staffId, 'staff', row.id, {
      action: 'added',
      displayName,
      role: row.role,
    });
    return { staff: toStaffView(row), enrollmentSecret: secret };
  });
}

async function requireStaffRow(executor: Executor, staffId: string): Promise<StaffRow> {
  const [row] = await executor.select().from(staff).where(eq(staff.id, staffId)).limit(1);
  if (!row) {
    throw new NotFoundError('Сотрудник не найден');
  }
  return row;
}

export async function updateStaffRole(
  ctx: CoreConfig,
  actor: Actor,
  staffId: string,
  role: StaffRole,
): Promise<StaffView> {
  const admin = requireAdmin(actor);

  return ctx.db.transaction(async (tx) => {
    const current = await requireStaffRow(tx, staffId);
    const [row] = await tx
      .update(staff)
      .set({ role })
      .where(eq(staff.id, staffId))
      .returning();

    await record(tx, admin.staffId, 'staff', staffId, {
      action: 'role',
      from: current.role,
      to: role,
    });
    return toStaffView(row!);
  });
}

/**
 * Отключение доступа. Действует немедленно: проверка сотрудника идёт
 * при каждом запросе, а не по содержимому выданной раньше сессии.
 */
export async function setStaffActive(
  ctx: CoreConfig,
  actor: Actor,
  staffId: string,
  isActive: boolean,
): Promise<StaffView> {
  const admin = requireAdmin(actor);
  // Иначе администратор закрывает доступ себе и остаётся ни с чем: в
  // сервисе может не быть второго администратора, чтобы его вернуть.
  if (staffId === admin.staffId && !isActive) {
    throw new InvalidInputError('Нельзя отключить самого себя');
  }

  return ctx.db.transaction(async (tx) => {
    await requireStaffRow(tx, staffId);
    const [row] = await tx
      .update(staff)
      .set({ isActive })
      .where(eq(staff.id, staffId))
      .returning();

    await record(tx, admin.staffId, 'staff', staffId, {
      action: isActive ? 'enabled' : 'disabled',
    });
    return toStaffView(row!);
  });
}

/**
 * Выдать второй фактор заново — при потере телефона и при подозрении,
 * что секрет утёк. Прежний перестаёт работать сразу.
 */
export async function resetStaffSecondFactor(
  ctx: CoreConfig,
  actor: Actor,
  staffId: string,
): Promise<StaffEnrollment> {
  const admin = requireAdmin(actor);
  const { secret, sealed } = sealedSecret(ctx);

  return ctx.db.transaction(async (tx) => {
    await requireStaffRow(tx, staffId);
    const [row] = await tx
      .update(staff)
      .set({ totpSecretSealed: sealed })
      .where(eq(staff.id, staffId))
      .returning();

    await record(tx, admin.staffId, 'staff', staffId, { action: 'second-factor-reset' });
    return { staff: toStaffView(row!), enrollmentSecret: secret };
  });
}

/**
 * Первый администратор: сотрудников ещё нет, и завести его некому.
 *
 * Работает только на пустом списке — дальше сотрудников заводит
 * администратор. Без этой операции развернутый сервис остался бы без
 * единого способа войти, а с ней после первого входа она уже ничего не
 * может: второй раз список пустым не будет.
 */
export async function enrollFirstAdmin(
  ctx: CoreConfig,
  input: { telegramUserId: bigint; displayName: string },
): Promise<StaffEnrollment> {
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new InvalidInputError('Укажите имя администратора');
  }
  const { secret, sealed } = sealedSecret(ctx);

  return ctx.db.transaction(async (tx) => {
    const existing = await tx.select({ id: staff.id }).from(staff).limit(1).for('update');
    if (existing.length > 0) {
      throw new ConflictError('Сотрудники уже заведены: нового добавляет администратор');
    }

    const [row] = await tx
      .insert(staff)
      .values({
        telegramUserId: input.telegramUserId,
        displayName,
        role: 'admin',
        totpSecretSealed: sealed,
      })
      .returning();

    return { staff: toStaffView(row!), enrollmentSecret: secret };
  });
}

export async function getServiceSettings(
  ctx: CoreConfig,
  actor: Actor,
): Promise<ServiceSettingsView> {
  requireAdmin(actor);
  return readServiceSettings(ctx.db);
}

export interface UpdateServiceSettingsInput {
  readonly referralLine1Bps?: number | undefined;
  readonly referralLine2Bps?: number | undefined;
  readonly minWithdrawalAmount?: string | undefined;
}

/** Ставка выше 100% отдавала бы рефереру больше, чем сервис заработал. */
function requireBps(value: number, subject: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new InvalidInputError(
      `${subject}: ожидаются целые базисные пункты от 0 до 10000 (10000 = 100%)`,
    );
  }
  return value;
}

export async function updateServiceSettings(
  ctx: CoreConfig,
  actor: Actor,
  input: UpdateServiceSettingsInput,
): Promise<ServiceSettingsView> {
  const admin = requireAdmin(actor);

  const patch: Record<string, number | string> = {};
  if (input.referralLine1Bps !== undefined) {
    patch.referralLine1Bps = requireBps(input.referralLine1Bps, 'Ставка первой линии');
  }
  if (input.referralLine2Bps !== undefined) {
    patch.referralLine2Bps = requireBps(input.referralLine2Bps, 'Ставка второй линии');
  }
  if (input.minWithdrawalAmount !== undefined) {
    const parsed = Money.amountSchema.safeParse(input.minWithdrawalAmount);
    if (!parsed.success || Money.isNegative(parsed.data)) {
      throw new InvalidInputError('Минимальная сумма вывода: ожидается неотрицательное число');
    }
    patch.minWithdrawalAmount = parsed.data;
  }
  if (Object.keys(patch).length === 0) {
    throw new InvalidInputError('Нечего менять');
  }

  return ctx.db.transaction(async (tx) => {
    const before = await readServiceSettings(tx);
    await tx
      .update(serviceSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(serviceSettings.id, 1));

    const after = await readServiceSettings(tx);
    await record(tx, admin.staffId, 'service_settings', null, { before, after });
    return after;
  });
}

export async function listCurrencyPairsForAdmin(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly CurrencyPairAdminView[]> {
  requireAdmin(actor);
  return ctx.db
    .select({
      id: currencyPairs.id,
      fromCode: currencyPairs.fromCode,
      toCode: currencyPairs.toCode,
      kind: currencyPairs.kind,
      markupBps: currencyPairs.markupBps,
      isActive: currencyPairs.isActive,
    })
    .from(currencyPairs)
    .orderBy(asc(currencyPairs.fromCode), asc(currencyPairs.toCode), asc(currencyPairs.kind));
}

/**
 * Наценка по направлению. Задаётся администратором, а не берётся из
 * кода: доходность сервиса — его решение, а не константа сборки.
 */
export async function updateCurrencyPairMarkup(
  ctx: CoreConfig,
  actor: Actor,
  pairId: string,
  markupBps: number,
): Promise<CurrencyPairAdminView> {
  const admin = requireAdmin(actor);
  requireBps(markupBps, 'Наценка направления');

  return ctx.db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(currencyPairs)
      .where(eq(currencyPairs.id, pairId))
      .limit(1);
    if (!current) {
      throw new NotFoundError('Направление обмена не найдено');
    }

    const [row] = await tx
      .update(currencyPairs)
      .set({ markupBps })
      .where(eq(currencyPairs.id, pairId))
      .returning();

    await record(tx, admin.staffId, 'currency_pair', pairId, {
      direction: `${current.fromCode} → ${current.toCode} (${current.kind})`,
      from: current.markupBps,
      to: markupBps,
    });

    return {
      id: row!.id,
      fromCode: row!.fromCode,
      toCode: row!.toCode,
      kind: row!.kind,
      markupBps: row!.markupBps,
      isActive: row!.isActive,
    };
  });
}

export async function listSettingsAuditLog(
  ctx: CoreConfig,
  actor: Actor,
  limit = 100,
): Promise<readonly SettingsAuditEntry[]> {
  requireAdmin(actor);
  return ctx.db
    .select({
      id: settingsAuditLog.id,
      staffId: settingsAuditLog.staffId,
      staffName: staff.displayName,
      subject: settingsAuditLog.subject,
      subjectId: settingsAuditLog.subjectId,
      changes: settingsAuditLog.changes,
      createdAt: settingsAuditLog.createdAt,
    })
    .from(settingsAuditLog)
    .innerJoin(staff, eq(staff.id, settingsAuditLog.staffId))
    .orderBy(desc(settingsAuditLog.createdAt), desc(sql`${settingsAuditLog.id}`))
    .limit(limit);
}
