import { and, count, desc, eq, ilike, inArray, lt, max, or, sql, sum, type SQL } from 'drizzle-orm';
import { clientMessages, clients, exchangeRequests, staff } from '@nemo/db';
import { Money } from '@nemo/types';
import { requireStaff, type Actor } from './actor.js';
import type { MoneyByCurrency } from './analytics.js';
import type { CoreConfig } from './context.js';
import { toManagerView, type ManagerExchangeRequestView } from './exchange-workflow.js';

/**
 * Клиенты списком — для раздела «Клиенты» в панели.
 *
 * До этого клиента было видно только врезкой в карточке заявки: найти
 * «того, кто менял баты в июле», было негде. Список отвечает на
 * вопросы менеджера: сколько раз с ним работали, чем кончилось, когда
 * в последний раз, ждёт ли он ответа сейчас.
 *
 * «Постоянный» — от трёх исполненных заявок. Это не уровень доверия и
 * не проверка личности, которых у сервиса нет, а подсказка «с этим
 * человеком уже работали». Оборот — по валютам раздельно и только по
 * исполненным: отменённая заявка денег не принесла.
 *
 * Обеим ролям: «с кем имею дело» — вопрос менеджера, а доход по
 * заявке он и так видит в её карточке.
 */

export const REGULAR_CLIENT_COMPLETED = 3;

export type ClientTab = 'all' | 'regular' | 'waiting';

export interface ClientFilter {
  /** Ник подстрокой или идентификатор целиком. */
  readonly query?: string | undefined;
  readonly tab?: ClientTab | undefined;
  readonly limit?: number | undefined;
  /**
   * Курсор по паре «время регистрации и идентификатор». Время — строкой
   * из самой базы (`ClientRow.cursor`), а не `Date`: у Postgres
   * микросекунды, у `Date` миллисекунды, и округлённая граница
   * пропускала бы строки, зарегистрированные в ту же миллисекунду.
   */
  readonly after?: { readonly createdAt: string; readonly id: bigint } | undefined;
}

export interface ClientRow {
  readonly telegramUserId: bigint;
  readonly username: string | null;
  readonly createdAt: Date;
  /** Точное время регистрации строкой — для курсора дочитывания. */
  readonly cursor: string;
  readonly completed: number;
  readonly cancelled: number;
  readonly open: number;
  readonly lastRequestAt: Date | null;
  readonly turnover: readonly MoneyByCurrency[];
  /** Последнее сообщение в переписке — от клиента, ответа ещё нет. */
  readonly waiting: boolean;
  readonly regular: boolean;
}

export interface ClientsSummary {
  readonly total: number;
  readonly regular: number;
  readonly withOpen: number;
  readonly waiting: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clientsLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

/** Экранирование для `ilike`: подчёркивание и процент — не шаблоны. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Клиенты с исполненными от порога — постоянные. */
function regularIds() {
  return sql`(select ${exchangeRequests.clientId} from ${exchangeRequests}
    where ${exchangeRequests.status} = 'completed'
    group by ${exchangeRequests.clientId}
    having count(*) >= ${REGULAR_CLIENT_COMPLETED})`;
}

/** Клиенты, чьё последнее сообщение — входящее без ответа. */
function waitingIds() {
  return sql`(select last.client_id from (
    select distinct on (${clientMessages.clientId}) ${clientMessages.clientId} as client_id,
      ${clientMessages.direction} as direction
    from ${clientMessages}
    order by ${clientMessages.clientId}, ${clientMessages.seq} desc
  ) as last where last.direction = 'incoming')`;
}

function whereFor(filter: ClientFilter): SQL | undefined {
  const parts: SQL[] = [];
  const query = filter.query?.trim().replace(/^@/, '');
  if (query) {
    parts.push(
      /^\d+$/.test(query)
        ? eq(clients.telegramUserId, BigInt(query))
        : ilike(clients.username, `%${escapeLike(query)}%`),
    );
  }
  if (filter.tab === 'regular') {
    parts.push(sql`${clients.telegramUserId} in ${regularIds()}`);
  }
  if (filter.tab === 'waiting') {
    parts.push(sql`${clients.telegramUserId} in ${waitingIds()}`);
  }
  if (filter.after) {
    const at = sql`${filter.after.createdAt}::timestamptz`;
    parts.push(
      or(
        sql`${clients.createdAt} < ${at}`,
        and(sql`${clients.createdAt} = ${at}`, lt(clients.telegramUserId, filter.after.id)),
      )!,
    );
  }
  return parts.length ? and(...parts) : undefined;
}

export async function countClients(
  ctx: CoreConfig,
  actor: Actor,
  filter: ClientFilter = {},
): Promise<number> {
  requireStaff(actor);
  const { after: _after, limit: _limit, ...rest } = filter;
  const [row] = await ctx.db.select({ n: count() }).from(clients).where(whereFor(rest));
  return row?.n ?? 0;
}

export async function listClients(
  ctx: CoreConfig,
  actor: Actor,
  filter: ClientFilter = {},
): Promise<readonly ClientRow[]> {
  requireStaff(actor);

  const base = await ctx.db
    .select({ client: clients, cursor: sql<string>`${clients.createdAt}::text` })
    .from(clients)
    .where(whereFor(filter))
    .orderBy(desc(clients.createdAt), desc(clients.telegramUserId))
    .limit(clientsLimit(filter.limit));
  if (base.length === 0) return [];

  const ids = base.map((row) => row.client.telegramUserId);
  const [counts, turnover, waiting] = await Promise.all([
    ctx.db
      .select({
        clientId: exchangeRequests.clientId,
        completed: sql<number>`count(*) filter (where ${exchangeRequests.status} = 'completed')::int`,
        cancelled: sql<number>`count(*) filter (where ${exchangeRequests.status} = 'cancelled')::int`,
        open: sql<number>`count(*) filter (where ${exchangeRequests.status} not in ('completed', 'cancelled'))::int`,
        lastRequestAt: max(exchangeRequests.createdAt),
      })
      .from(exchangeRequests)
      .where(inArray(exchangeRequests.clientId, ids))
      .groupBy(exchangeRequests.clientId),
    ctx.db
      .select({
        clientId: exchangeRequests.clientId,
        code: exchangeRequests.fromCode,
        amount: sum(exchangeRequests.fromAmount),
        n: count(),
      })
      .from(exchangeRequests)
      .where(and(inArray(exchangeRequests.clientId, ids), eq(exchangeRequests.status, 'completed')))
      .groupBy(exchangeRequests.clientId, exchangeRequests.fromCode),
    ctx.db
      .select({ clientId: clients.telegramUserId })
      .from(clients)
      .where(
        and(
          inArray(clients.telegramUserId, ids),
          sql`${clients.telegramUserId} in ${waitingIds()}`,
        ),
      ),
  ]);

  const countsBy = new Map(counts.map((row) => [row.clientId.toString(), row]));
  const turnoverBy = new Map<string, MoneyByCurrency[]>();
  for (const row of turnover) {
    const key = row.clientId.toString();
    const lines = turnoverBy.get(key) ?? [];
    lines.push({ code: row.code, amount: Money.toAmount(row.amount ?? '0'), count: row.n });
    turnoverBy.set(key, lines);
  }
  const waitingSet = new Set(waiting.map((row) => row.clientId.toString()));

  return base.map(({ client: row, cursor }) => {
    const key = row.telegramUserId.toString();
    const stat = countsBy.get(key);
    const completed = stat?.completed ?? 0;
    return {
      telegramUserId: row.telegramUserId,
      username: row.username,
      createdAt: row.createdAt,
      cursor,
      completed,
      cancelled: stat?.cancelled ?? 0,
      open: stat?.open ?? 0,
      lastRequestAt: stat?.lastRequestAt ?? null,
      turnover: (turnoverBy.get(key) ?? []).sort((a, b) => a.code.localeCompare(b.code)),
      waiting: waitingSet.has(key),
      regular: completed >= REGULAR_CLIENT_COMPLETED,
    };
  });
}

export async function summarizeClients(ctx: CoreConfig, actor: Actor): Promise<ClientsSummary> {
  requireStaff(actor);
  const [total, regular, withOpen, waiting] = await Promise.all([
    ctx.db.select({ n: count() }).from(clients),
    ctx.db
      .select({ n: count() })
      .from(clients)
      .where(sql`${clients.telegramUserId} in ${regularIds()}`),
    ctx.db
      .select({ n: sql<number>`count(distinct ${exchangeRequests.clientId})::int` })
      .from(exchangeRequests)
      .where(sql`${exchangeRequests.status} not in ('completed', 'cancelled')`),
    ctx.db
      .select({ n: count() })
      .from(clients)
      .where(sql`${clients.telegramUserId} in ${waitingIds()}`),
  ]);
  return {
    total: total[0]?.n ?? 0,
    regular: regular[0]?.n ?? 0,
    withOpen: withOpen[0]?.n ?? 0,
    waiting: waiting[0]?.n ?? 0,
  };
}

/**
 * Заявки клиента — сотруднику, новые сверху, с пределом и курсором по
 * паре «время подачи и идентификатор».
 */
export async function listClientExchangeRequests(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
  options: {
    readonly limit?: number | undefined;
    readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
  } = {},
): Promise<readonly ManagerExchangeRequestView[]> {
  requireStaff(actor);
  const cursor = options.after
    ? or(
        lt(exchangeRequests.createdAt, options.after.createdAt),
        and(
          eq(exchangeRequests.createdAt, options.after.createdAt),
          lt(exchangeRequests.id, options.after.id),
        ),
      )
    : undefined;
  const rows = await ctx.db
    .select({
      request: exchangeRequests,
      username: clients.username,
      managerName: staff.displayName,
    })
    .from(exchangeRequests)
    .innerJoin(clients, eq(clients.telegramUserId, exchangeRequests.clientId))
    .leftJoin(staff, eq(staff.id, exchangeRequests.assignedManagerId))
    .where(and(eq(exchangeRequests.clientId, clientId), cursor))
    .orderBy(desc(exchangeRequests.createdAt), desc(exchangeRequests.id))
    .limit(clientsLimit(options.limit));
  return rows.map((row) => toManagerView(row.request, row.username, row.managerName));
}
