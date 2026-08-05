import { and, eq, isNull } from 'drizzle-orm';
import { open, verifyTotp } from '@nemo/crypto';
import { staff } from '@nemo/db';
import type { StaffRole } from '@nemo/types';
import { requirePrivateKey, type CoreConfig, type Executor } from './context.js';
import { ForbiddenError } from './errors.js';
import { otpauthUri } from './second-factor.js';

/**
 * Вход сотрудника в админ-панель.
 *
 * Telegram Login — первый фактор, и подтверждает он ровно одно:
 * аккаунтом владеет тот, кто нажал кнопку. Прав это не даёт. Допуск
 * выдаётся по списку сотрудников, сессия — только после одноразового
 * кода: за админкой лежат чужие номера карт, и угнанный Telegram не
 * должен их открывать.
 *
 * Секрет второго фактора заводит администратор (`admin.ts`), а не вход.
 * Но выданный секрет ещё надо донести до приложения сотрудника, и
 * ровно здесь он терялся: код для камеры видел администратор, а
 * заносил ключ не он. Сотрудник упирался в поле для кода, которого ему
 * взять неоткуда, — и не мог войти вовсе.
 *
 * Поэтому выданный, но ни разу не сработавший ключ вход показывает
 * сам — тому, кто только что подтвердил владение аккаунтом в Telegram.
 * Один раз: первый сошедшийся код закрывает показ навсегда. Окно между
 * выдачей и первым входом остаётся тем местом, где угнанный аккаунт
 * заводит ключ себе, — но оно узкое и заметное, а прежняя выдача
 * втёмную кончалась тем, что вход не работал ни у кого.
 *
 * Отказ всегда одинаков. Разные ответы на «не сотрудник», «уволен» и
 * «второй фактор не выдан» сообщали бы подбирающему, где он остановился.
 */

export const DENIED = 'Доступ запрещён';

export interface StaffSession {
  readonly staffId: string;
  readonly role: StaffRole;
  /** Кем сотрудник подписан в панели: строка уже прочитана, лишнего запроса нет. */
  readonly displayName: string;
}

/**
 * Итог первого шага. Признак живёт здесь, а не в самой сессии: он
 * нужен ровно между Telegram Login и кодом, и в действующей сессии
 * означал бы ничего.
 */
export interface StaffLoginStart extends StaffSession {
  /**
   * Ключ выдан, но ни разу не подошёл: вход покажет его сам, иначе
   * сотруднику неоткуда взять код.
   */
  readonly secondFactorPending: boolean;
}

/**
 * Выданный ключ для приложения-аутентификатора: строкой и ссылкой,
 * из которой рисуется код для камеры.
 */
export interface SecondFactorEnrollment {
  readonly enrollmentSecret: string;
  readonly otpauthUri: string;
}

type StaffRow = typeof staff.$inferSelect;

async function findActive(executor: Executor, staffId: string): Promise<StaffRow> {
  const [row] = await executor.select().from(staff).where(eq(staff.id, staffId)).limit(1);
  if (!row?.isActive) {
    throw new ForbiddenError(DENIED);
  }
  return row;
}

function toSession(row: StaffRow): StaffSession {
  return { staffId: row.id, role: row.role, displayName: row.displayName };
}

/**
 * Первый шаг входа: сотрудник опознан по Telegram, но сессии ещё нет.
 *
 * Доступ проверяется здесь, а не при выдаче сессии, чтобы уволенный не
 * дошёл даже до ввода кода. Сотрудник без выданного второго фактора
 * тоже не дойдёт: заводить секрет входу нечем и не положено — выдаёт
 * его администратор.
 */
export async function beginStaffLogin(
  ctx: CoreConfig,
  telegramUserId: bigint,
): Promise<StaffLoginStart> {
  const [row] = await ctx.db
    .select()
    .from(staff)
    .where(eq(staff.telegramUserId, telegramUserId))
    .limit(1);

  if (!row?.isActive || !row.totpSecretSealed) {
    throw new ForbiddenError(DENIED);
  }
  return { ...toSession(row), secondFactorPending: row.secondFactorConfirmedAt === null };
}

/**
 * Показать выданный ключ тому, кто прошёл первый шаг входа.
 *
 * Только пока ключ ни разу не сработал. Ключ тот же, что выдал
 * администратор, — не новый: новый обесценил бы код для камеры,
 * который администратор уже отдал сотруднику, и пара сходилась бы
 * ровно у того, кто открыл вход последним.
 *
 * Вызывать эту операцию можно только после проверенной подписи
 * Telegram Login: она отдаёт второй фактор целиком.
 */
export async function claimSecondFactor(
  ctx: CoreConfig,
  staffId: string,
): Promise<SecondFactorEnrollment> {
  const row = await findActive(ctx.db, staffId);
  if (!row.totpSecretSealed || row.secondFactorConfirmedAt !== null) {
    throw new ForbiddenError(DENIED);
  }

  const secret = open(requirePrivateKey(ctx), row.totpSecretSealed);
  return {
    enrollmentSecret: secret,
    otpauthUri: otpauthUri({ telegramUserId: row.telegramUserId, role: row.role }, secret),
  };
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

  /*
   * Сошедшийся код — единственное доказательство, что ключ доехал до
   * приложения сотрудника. Им и закрывается показ ключа на входе.
   * Условие `is null` стоит в самом запросе, а не только в коде: два
   * входа, начатых одновременно, иначе переписали бы отметку, и первый
   * сошедшийся код перестал бы быть первым.
   */
  if (row.secondFactorConfirmedAt === null) {
    await ctx.db
      .update(staff)
      .set({ secondFactorConfirmedAt: new Date() })
      .where(and(eq(staff.id, row.id), isNull(staff.secondFactorConfirmedAt)));
  }
  return toSession(row);
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
  return toSession(row);
}
