import { eq } from 'drizzle-orm';
import { open, verifyTotp } from '@nemo/crypto';
import { staff } from '@nemo/db';
import type { StaffRole } from '@nemo/types';
import { requirePrivateKey, type CoreConfig, type Executor } from './context.js';
import { ForbiddenError } from './errors.js';

/**
 * Вход сотрудника в админ-панель.
 *
 * Telegram Login — первый фактор, и подтверждает он ровно одно:
 * аккаунтом владеет тот, кто нажал кнопку. Прав это не даёт. Допуск
 * выдаётся по списку сотрудников, сессия — только после одноразового
 * кода: за админкой лежат чужие номера карт, и угнанный Telegram не
 * должен их открывать.
 *
 * Секрет второго фактора выдаёт администратор при заведении сотрудника
 * (`admin.ts`), а не сам вход. Секрет, который заводится при первом
 * входе, отдаёт админку тому, кто угнал аккаунт до этого входа, — то
 * есть не срабатывает ровно в том случае, ради которого заведён.
 *
 * Отказ всегда одинаков. Разные ответы на «не сотрудник», «уволен» и
 * «второй фактор не выдан» сообщали бы подбирающему, где он остановился.
 */

export const DENIED = 'Доступ запрещён';

export interface StaffSession {
  readonly staffId: string;
  readonly role: StaffRole;
}

type StaffRow = typeof staff.$inferSelect;

async function findActive(executor: Executor, staffId: string): Promise<StaffRow> {
  const [row] = await executor.select().from(staff).where(eq(staff.id, staffId)).limit(1);
  if (!row?.isActive) {
    throw new ForbiddenError(DENIED);
  }
  return row;
}

/**
 * Первый шаг входа: сотрудник опознан по Telegram, но сессии ещё нет.
 *
 * Доступ проверяется здесь, а не при выдаче сессии, чтобы уволенный не
 * дошёл даже до ввода кода. Сотрудник без выданного второго фактора
 * тоже не дойдёт: заводить секрет входу нечем и не положено.
 */
export async function beginStaffLogin(
  ctx: CoreConfig,
  telegramUserId: bigint,
): Promise<StaffSession> {
  const [row] = await ctx.db
    .select()
    .from(staff)
    .where(eq(staff.telegramUserId, telegramUserId))
    .limit(1);

  if (!row?.isActive || !row.totpSecretSealed) {
    throw new ForbiddenError(DENIED);
  }
  return { staffId: row.id, role: row.role };
}

/** Второй шаг: без верного кода сессия не выдаётся. */
export async function completeStaffLogin(
  ctx: CoreConfig,
  staffId: string,
  code: string,
): Promise<StaffSession> {
  const row = await findActive(ctx.db, staffId);
  if (!row.totpSecretSealed) {
    throw new ForbiddenError(DENIED);
  }

  const secret = open(requirePrivateKey(ctx), row.totpSecretSealed);
  if (!verifyTotp(secret, code)) {
    throw new ForbiddenError(DENIED);
  }
  return { staffId: row.id, role: row.role };
}

/**
 * Проверка сессии при каждом запросе админки.
 *
 * Отдельным запросом в базу, а не по содержимому куки: увольнение
 * должно закрывать доступ немедленно, а не когда истечёт выданная
 * раньше сессия.
 */
export async function getActiveStaff(
  ctx: CoreConfig,
  staffId: string,
): Promise<StaffSession> {
  const row = await findActive(ctx.db, staffId);
  return { staffId: row.id, role: row.role };
}
