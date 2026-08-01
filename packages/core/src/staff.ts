import { eq } from 'drizzle-orm';
import { generateTotpSecret, open, seal, verifyTotp } from '@nemo/crypto';
import { staff } from '@nemo/db';
import type { StaffRole } from '@nemo/types';
import {
  requirePrivateKey,
  requirePublicKey,
  type CoreConfig,
  type Executor,
} from './context.js';
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
 * Отказ всегда одинаков. Разные ответы на «не сотрудник», «уволен» и
 * «неверный код» сообщали бы подбирающему, где он остановился.
 */

const DENIED = 'Доступ запрещён';

export interface StaffSession {
  readonly staffId: string;
  readonly role: StaffRole;
}

export interface BeginStaffLoginResult extends StaffSession {
  /**
   * Секрет второго фактора — только при первом входе, когда его ещё
   * нужно завести в приложении-аутентификаторе. Дальше не показывается:
   * второй раз он и не нужен, и опасен.
   */
  readonly enrollmentSecret?: string;
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
 * дошёл даже до ввода кода.
 */
export async function beginStaffLogin(
  ctx: CoreConfig,
  telegramUserId: bigint,
): Promise<BeginStaffLoginResult> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(staff)
      .where(eq(staff.telegramUserId, telegramUserId))
      .limit(1);

    if (!row?.isActive) {
      throw new ForbiddenError(DENIED);
    }
    if (row.totpSecretSealed) {
      return { staffId: row.id, role: row.role };
    }

    // Секрет второго фактора шифруется тем же ключом, что и реквизиты:
    // оба читаются только в админке, и заводить для них два разных ключа
    // значило бы удвоить число мест, где ключ можно потерять.
    const secret = generateTotpSecret();
    await tx
      .update(staff)
      .set({ totpSecretSealed: seal(requirePublicKey(ctx), secret) })
      .where(eq(staff.id, row.id));

    return { staffId: row.id, role: row.role, enrollmentSecret: secret };
  });
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
