import { asc, desc, eq, sql } from 'drizzle-orm';
import { generateTotpSecret, seal } from '@nemo/crypto';
import { serviceSettings, settingsAuditLog, staff } from '@nemo/db';
import { Money, type StaffRole } from '@nemo/types';
import { requireAdmin, type Actor } from './actor.js';
import { requirePublicKey, type CoreConfig, type Executor } from './context.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import { otpauthUri } from './second-factor.js';
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
 * менять условия заявки, исполненной давным-давно.
 *
 * Каждое изменение записывается в журнал. Вопрос «почему за эту заявку
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
  /**
   * Тот же секрет ссылкой для приложения-аутентификатора: из неё
   * рисуется код для камеры и в админке, и в скрипте развёртывания.
   */
  readonly otpauthUri: string;
}

export interface AddStaffInput {
  readonly telegramUserId: bigint;
  readonly displayName: string;
  readonly role?: StaffRole | undefined;
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

async function recordSettingsChange(
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

/** Что выдаётся на руки после смены секрета: сам ключ и ссылка на него. */
function enrollmentOf(row: StaffRow, secret: string): StaffEnrollment {
  const view = toStaffView(row);
  return {
    staff: view,
    enrollmentSecret: secret,
    otpauthUri: otpauthUri({ telegramUserId: view.telegramUserId, role: view.role }, secret),
  };
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

    await recordSettingsChange(tx, admin.staffId, 'staff', row.id, {
      action: 'added',
      displayName,
      role: row.role,
    });
    return enrollmentOf(row, secret);
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

    await recordSettingsChange(tx, admin.staffId, 'staff', staffId, {
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

    await recordSettingsChange(tx, admin.staffId, 'staff', staffId, {
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

    await recordSettingsChange(tx, admin.staffId, 'staff', staffId, { action: 'second-factor-reset' });
    return enrollmentOf(row!, secret);
  });
}

/**
 * Выдать второй фактор заново из консоли сервера.
 *
 * Тот же сброс, что и в админке, но без администратора: администратор,
 * потерявший собственный второй фактор, войти и сбросить его себе не
 * может, а другого администратора в сервисе может не быть вовсе. Без
 * этой операции такая потеря запирает админку насовсем — при живой базе
 * и работающем деплое.
 *
 * Прав она не спрашивает, и защищает её только доступ к серверу — как и
 * `enrollFirstAdmin`. Поэтому вызывать её можно ровно из скрипта
 * развёртывания: маршрут, дающий эту операцию по сети, отдал бы админку
 * тому, кто первым угадает адрес.
 *
 * Сотрудник ищется по Telegram, а не по идентификатору строки: у того,
 * кто запускает скрипт, есть Telegram сотрудника — из переписки, — а
 * uuid он взял бы только из той самой админки, в которую не может войти.
 *
 * В журнал изменений это не пишется. Журнал отвечает на вопрос «кто из
 * сотрудников поменял», а здесь менял не сотрудник, а тот, у кого доступ
 * к серверу: записать его чужим именем значило бы соврать в единственном
 * месте, куда потом придут разбираться.
 */
export async function reissueSecondFactorFromConsole(
  ctx: CoreConfig,
  telegramUserId: bigint,
): Promise<StaffEnrollment> {
  const { secret, sealed } = sealedSecret(ctx);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(staff)
      .set({ totpSecretSealed: sealed })
      .where(eq(staff.telegramUserId, telegramUserId))
      .returning();

    if (!row) {
      throw new NotFoundError('Сотрудник с таким Telegram не заведён');
    }
    return enrollmentOf(row, secret);
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

    return enrollmentOf(row!, secret);
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
  readonly markupBps?: number | undefined;
  readonly minExchangeAmount?: string | undefined;
  readonly unpaidExchangeRequestTtlMinutes?: number | undefined;
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

function requireNonNegativeAmount(value: string, subject: string): string {
  const parsed = Money.amountSchema.safeParse(value);
  if (!parsed.success || Money.isNegative(parsed.data)) {
    throw new InvalidInputError(`${subject}: ожидается неотрицательное число`);
  }
  return parsed.data;
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
    patch.minWithdrawalAmount = requireNonNegativeAmount(
      input.minWithdrawalAmount,
      'Минимальная сумма вывода',
    );
  }
  if (input.markupBps !== undefined) {
    patch.markupBps = requireBps(input.markupBps, 'Наценка');
  }
  if (input.minExchangeAmount !== undefined) {
    patch.minExchangeAmount = requireNonNegativeAmount(
      input.minExchangeAmount,
      'Минимальная сумма обмена',
    );
  }
  if (input.unpaidExchangeRequestTtlMinutes !== undefined) {
    // Нулевой срок отменял бы заявку в тот же миг, когда менеджер выдал
    // реквизиты: клиент не успел бы даже открыть банк.
    const minutes = input.unpaidExchangeRequestTtlMinutes;
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new InvalidInputError(
        'Срок жизни неоплаченной заявки: ожидается целое число минут больше нуля',
      );
    }
    patch.unpaidExchangeRequestTtlMinutes = minutes;
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
    await recordSettingsChange(tx, admin.staffId, 'service_settings', null, { before, after });
    return after;
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
