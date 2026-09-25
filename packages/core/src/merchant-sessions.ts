import { and, desc, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { merchantSessions, merchantUsers } from '@nemo/db';
import { requireMerchantUser, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { NotFoundError } from './errors.js';

/**
 * Сессии кабинета мерчанта (24 сентября 2026, по образцу «Сессий»
 * Love&Pay): где человек вошёл и чем отключить незнакомое устройство.
 *
 * До этого сессия была одной подписанной кукой без записи, и оборвать
 * её можно было только вместе со всеми — сменой пароля. Теперь кука
 * несёт номер записи, а запись — поколение человека на момент входа:
 * отключение гасит одну строку, а смена пароля и закрытие доступа, как
 * и прежде, поднимают поколение и обрывают все разом, не перебирая их.
 *
 * Сессии — свойство человека, а не организации (ADR-0023): каждый
 * видит и отключает свои. Владелец чужие не отключает — он закрывает
 * доступ человеку целиком, и это уже есть в «Сотрудниках».
 */

/**
 * Тридцать суток — как было у куки: кабинет открывают раз в неделю, и
 * вход по паролю на каждый заход означал бы пароль, записанный в
 * браузере или на бумаге. Срок не продлевается работой: обрывается
 * сессия отключением и сменой пароля, и это быстрее любого срока.
 */
export const MERCHANT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Как часто обновлять «была активность»: запись на каждый запрос
 * удваивала бы обращения к базе ради слов, которые читают раз в неделю.
 */
const LAST_SEEN_GRAIN_MS = 5 * 60 * 1000;

/** Строка браузера режется: её присылает кто угодно, а читать её целиком незачем. */
const MAX_USER_AGENT = 400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeSessionId(value: string): boolean {
  return UUID.test(value);
}

/** Сессия глазами её владельца. */
export interface MerchantSessionView {
  readonly id: string;
  /** Строка браузера при входе; словами её называет кабинет. */
  readonly userAgent: string | null;
  /** Адрес последнего обращения. */
  readonly address: string | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

/** Откуда вошли: для списка сессий и отметки активности. */
export interface SessionClient {
  readonly userAgent?: string | null | undefined;
  readonly address?: string | null | undefined;
}

/** Запись о входе. Зовётся из входа, после проверки пароля. */
export async function startMerchantSession(
  executor: Executor,
  user: { readonly id: string; readonly sessionEpoch: number },
  client: SessionClient,
  now: Date = new Date(),
): Promise<{ readonly id: string; readonly expiresAt: Date }> {
  const [row] = await executor
    .insert(merchantSessions)
    .values({
      merchantUserId: user.id,
      sessionEpoch: user.sessionEpoch,
      userAgent: client.userAgent ? client.userAgent.slice(0, MAX_USER_AGENT) : null,
      address: client.address ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + MERCHANT_SESSION_TTL_MS),
    })
    .returning({ id: merchantSessions.id, expiresAt: merchantSessions.expiresAt });
  return row!;
}

/**
 * Действует ли сессия: своя, не отключена, не истекла и того же
 * поколения, что человек. Отметка активности обновляется здесь же —
 * не чаще раза в пять минут, вместе с адресом последнего обращения.
 */
export async function sessionIsLive(
  executor: Executor,
  userId: string,
  sessionId: string,
  client: SessionClient = {},
  now: Date = new Date(),
): Promise<boolean> {
  if (!looksLikeSessionId(sessionId)) return false;

  const [row] = await executor
    .select({ lastSeenAt: merchantSessions.lastSeenAt, address: merchantSessions.address })
    .from(merchantSessions)
    .innerJoin(merchantUsers, eq(merchantUsers.id, merchantSessions.merchantUserId))
    .where(
      and(
        eq(merchantSessions.id, sessionId),
        eq(merchantSessions.merchantUserId, userId),
        isNull(merchantSessions.revokedAt),
        gt(merchantSessions.expiresAt, now),
        eq(merchantSessions.sessionEpoch, merchantUsers.sessionEpoch),
      ),
    )
    .limit(1);
  if (!row) return false;

  if (now.getTime() - row.lastSeenAt.getTime() >= LAST_SEEN_GRAIN_MS) {
    await executor
      .update(merchantSessions)
      .set({ lastSeenAt: now, ...(client.address ? { address: client.address } : {}) })
      .where(eq(merchantSessions.id, sessionId));
  }
  return true;
}

/**
 * Живые сессии вошедшего: не отключённые, не истёкшие и того же
 * поколения — сессии до смены пароля в список не попадают, они уже
 * ничего не открывают. Свежие первыми.
 */
export async function listMerchantSessions(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly MerchantSessionView[]> {
  const userId = requireMerchantUser(actor);
  const rows = await ctx.db
    .select({
      id: merchantSessions.id,
      userAgent: merchantSessions.userAgent,
      address: merchantSessions.address,
      createdAt: merchantSessions.createdAt,
      lastSeenAt: merchantSessions.lastSeenAt,
      expiresAt: merchantSessions.expiresAt,
    })
    .from(merchantSessions)
    .innerJoin(merchantUsers, eq(merchantUsers.id, merchantSessions.merchantUserId))
    .where(liveOf(userId))
    .orderBy(desc(merchantSessions.lastSeenAt), desc(merchantSessions.createdAt));
  return rows;
}

function liveOf(userId: string) {
  return and(
    eq(merchantSessions.merchantUserId, userId),
    isNull(merchantSessions.revokedAt),
    gt(merchantSessions.expiresAt, sql`now()`),
    eq(merchantSessions.sessionEpoch, merchantUsers.sessionEpoch),
  );
}

/**
 * Отключить одну свою сессию. Чужая и уже отключённая — «не найдена»:
 * перебором номеров нельзя узнать, чьи сессии живы.
 */
export async function revokeMerchantSession(
  ctx: CoreConfig,
  actor: Actor,
  sessionId: string,
): Promise<void> {
  const userId = requireMerchantUser(actor);
  if (!looksLikeSessionId(sessionId)) throw new NotFoundError('Сессия не найдена');

  const revoked = await ctx.db
    .update(merchantSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(merchantSessions.id, sessionId),
        eq(merchantSessions.merchantUserId, userId),
        isNull(merchantSessions.revokedAt),
      ),
    )
    .returning({ id: merchantSessions.id });
  if (revoked.length === 0) throw new NotFoundError('Сессия не найдена');
}

/**
 * Отключить все свои сессии, кроме той, с которой нажали: увидел
 * незнакомое — выключил всё чужое, не выходя сам. Возвращает, сколько
 * отключено.
 */
export async function revokeOtherMerchantSessions(
  ctx: CoreConfig,
  actor: Actor,
  keepSessionId: string,
): Promise<number> {
  const userId = requireMerchantUser(actor);
  const revoked = await ctx.db
    .update(merchantSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(merchantSessions.merchantUserId, userId),
        isNull(merchantSessions.revokedAt),
        looksLikeSessionId(keepSessionId) ? ne(merchantSessions.id, keepSessionId) : undefined,
      ),
    )
    .returning({ id: merchantSessions.id });
  return revoked.length;
}

/**
 * Выход: гасится та сессия, с которой вышли. Без исполнителя — его
 * устанавливает кука, как и при входе; кука подписана, и чужой номер в
 * ней не подделать. Незнакомый номер молча пропускается: выходящему всё
 * равно, была ли запись.
 */
export async function endMerchantSession(
  ctx: CoreConfig,
  userId: string,
  sessionId: string,
): Promise<void> {
  if (!looksLikeSessionId(sessionId)) return;
  await ctx.db
    .update(merchantSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(merchantSessions.id, sessionId),
        eq(merchantSessions.merchantUserId, userId),
        isNull(merchantSessions.revokedAt),
      ),
    );
}

/**
 * Чистка: истёкшие и отключённые раньше срока — вон. Зовёт планировщик
 * тем же маршрутом, что чистит журнал вызовов. Возвращает число строк.
 */
export async function purgeMerchantSessions(ctx: CoreConfig, olderThan: Date): Promise<number> {
  const deleted = await ctx.db
    .delete(merchantSessions)
    .where(or(lt(merchantSessions.expiresAt, olderThan), lt(merchantSessions.revokedAt, olderThan)))
    .returning({ id: merchantSessions.id });
  return deleted.length;
}
