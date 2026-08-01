import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { open } from '@nemo/crypto';
import {
  clientRequisites,
  exchangeRequests,
  requisiteAccessLog,
  staff,
} from '@nemo/db';
import { requireAdmin, requireStaff, type Actor } from './actor.js';
import { requirePrivateKey, type CoreConfig } from './context.js';
import { NotFoundError } from './errors.js';
import { requireOwnership } from './exchange-workflow.js';

/**
 * Чтение полного номера карты менеджером и журнал таких чтений.
 *
 * Расшифровать реквизиты может только админ-панель: приватного ключа в
 * клиентском деплое нет физически (docs/adr/0002). Но одного этого мало
 * — сотрудник с доступом к админке видит чужие номера карт, и должно
 * оставаться, кто и когда их видел.
 *
 * Запись в журнал идёт в той же транзакции, что и чтение, и вызывающая
 * сторона не может её пропустить: расшифрованный номер возвращается
 * только после того, как строка журнала записана. Отдельная операция
 * «записать в журнал», которую можно не позвать, держалась бы на памяти
 * того, кто пишет следующий экран.
 *
 * Журнал только на чтение и только администратору: правки в нём не
 * предусмотрены, а менеджер — тот, за кем он ведётся.
 */

export interface RevealedRequisites {
  readonly bankName: string | null;
  readonly phone: string | null;
  /** Полный номер карты. Показывается менеджеру и нигде не хранится. */
  readonly cardNumber: string | null;
  readonly cardLast4: string | null;
}

export interface RequisiteAccessEntry {
  readonly id: string;
  readonly staffId: string;
  readonly staffName: string;
  readonly clientId: bigint;
  readonly exchangeRequestId: string | null;
  readonly accessedAt: Date;
}

/**
 * Реквизиты клиента по заявке на обмен, которую ведёт менеджер.
 *
 * Заявка обязательна: доступ к чужому номеру карты имеет смысл только
 * в связи с работой по конкретной сделке, и журнал должен отвечать не
 * только «кто смотрел», но и «зачем».
 */
export async function revealRequisites(
  ctx: CoreConfig,
  actor: Actor,
  exchangeRequestId: string,
): Promise<RevealedRequisites> {
  requireStaff(actor);
  const privateKey = requirePrivateKey(ctx);

  return ctx.db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(exchangeRequests)
      .where(eq(exchangeRequests.id, exchangeRequestId))
      .limit(1);
    if (!request) {
      throw new NotFoundError('Заявка на обмен не найдена');
    }
    const staffId = requireOwnership(request, actor);

    if (!request.requisitesId) {
      throw new NotFoundError('К заявке на обмен не приложены реквизиты');
    }

    const [row] = await tx
      .select()
      .from(clientRequisites)
      .where(eq(clientRequisites.id, request.requisitesId))
      .limit(1);
    if (!row) {
      throw new NotFoundError('Реквизиты не найдены');
    }

    await tx.insert(requisiteAccessLog).values({
      staffId,
      requisitesId: row.id,
      exchangeRequestId: request.id,
    });

    return {
      bankName: row.bankName,
      phone: row.phone,
      cardNumber: row.cardSealed ? open(privateKey, row.cardSealed) : null,
      cardLast4: row.cardLast4,
    };
  });
}

export interface RequisiteAccessFilter {
  readonly staffId?: string | undefined;
  readonly clientId?: bigint | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export async function listRequisiteAccessLog(
  ctx: CoreConfig,
  actor: Actor,
  filter: RequisiteAccessFilter = {},
): Promise<readonly RequisiteAccessEntry[]> {
  requireAdmin(actor);

  const conditions: SQL[] = [];
  if (filter.staffId) conditions.push(eq(requisiteAccessLog.staffId, filter.staffId));
  if (filter.clientId !== undefined) {
    conditions.push(eq(clientRequisites.clientId, filter.clientId));
  }
  if (filter.from) conditions.push(gte(requisiteAccessLog.accessedAt, filter.from));
  if (filter.to) conditions.push(lte(requisiteAccessLog.accessedAt, filter.to));

  const rows = await ctx.db
    .select({
      id: requisiteAccessLog.id,
      staffId: requisiteAccessLog.staffId,
      staffName: staff.displayName,
      clientId: clientRequisites.clientId,
      exchangeRequestId: requisiteAccessLog.exchangeRequestId,
      accessedAt: requisiteAccessLog.accessedAt,
    })
    .from(requisiteAccessLog)
    .innerJoin(staff, eq(staff.id, requisiteAccessLog.staffId))
    .innerJoin(clientRequisites, eq(clientRequisites.id, requisiteAccessLog.requisitesId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(requisiteAccessLog.accessedAt));

  return rows;
}
