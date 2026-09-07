import { and, count, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm';
import { apiKeys, apiRequestLog } from '@nemo/db';
import { requireMerchant, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { InvalidInputError } from './errors.js';

/**
 * Журнал вызовов API: что мерчант спрашивал и что ему ответили.
 *
 * Пишет адаптер после каждого вызова, включая отвергнутые с узнанным
 * ключом: «401 по отозванному ключу» в журнале мерчанта отвечает на
 * вопрос, почему у него встала интеграция, быстрее, чем поддержка.
 * Читает мерчант в кабинете — свежие первыми, курсором по паре «время
 * и номер»: вызовы идут пачкой, и десяток в одну секунду — норма.
 *
 * Хранится тридцать дней: журнал нужен, чтобы разобрать вчерашнюю
 * ошибку, а не как история. Чистит планировщик.
 */

export const API_LOG_RETENTION_DAYS = 30;

export interface ApiRequestLogInput {
  readonly merchantId: string;
  readonly apiKeyId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly address?: string | null | undefined;
  readonly error?: string | null | undefined;
  /** Момент вызова; не задан — сейчас. Тесты подставляют свой. */
  readonly at?: Date | undefined;
}

export interface ApiRequestLogEntry {
  /** Номер строки — строкой: `bigint` через границу JSON не переезжает. */
  readonly id: string;
  readonly keyId: string;
  readonly keyLabel: string;
  readonly keyHint: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly address: string | null;
  readonly error: string | null;
  readonly at: Date;
}

export interface ApiRequestLogFilter {
  /** Успешные — ответ короче 400 — или отказы. Не задано — все. */
  readonly outcome?: 'ok' | 'error' | undefined;
  readonly keyId?: string | undefined;
  readonly limit?: number | undefined;
  readonly after?: { readonly at: Date; readonly id: string } | undefined;
}

export interface ApiRequestLogSummary {
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
  /** Среднее время ответа; `null`, когда вызовов не было, — не ноль. */
  readonly averageDurationMs: number | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Ответы короче 400 — успех. Граница та же, что у HTTP. */
const FIRST_ERROR_STATUS = 400;

/** Считается ли ответ отказом — одним правилом для плиток, табов и строк. */
export function isFailedApiStatus(status: number): boolean {
  return status >= FIRST_ERROR_STATUS;
}

/** Слова отказа в журнале режутся: он про то, что случилось, а не про весь текст. */
const MAX_ERROR = 300;

export async function logApiRequest(ctx: CoreConfig, input: ApiRequestLogInput): Promise<void> {
  await ctx.db.insert(apiRequestLog).values({
    merchantId: input.merchantId,
    apiKeyId: input.apiKeyId,
    method: input.method,
    path: input.path,
    status: input.status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    address: input.address ?? null,
    error: input.error ? input.error.slice(0, MAX_ERROR) : null,
    /*
     * Момент ставится здесь, а не `now()` базы: у Postgres микросекунды,
     * а курсор едет через JSON строкой до миллисекунды — строка, что
     * старше курсора на микросекунды, иначе выпадала бы между страницами.
     */
    at: input.at ?? new Date(),
  });
}

function conditions(merchantId: string, filter: ApiRequestLogFilter): SQL[] {
  const list: SQL[] = [eq(apiRequestLog.merchantId, merchantId)];
  if (filter.outcome === 'ok') list.push(lt(apiRequestLog.status, FIRST_ERROR_STATUS));
  if (filter.outcome === 'error') list.push(gte(apiRequestLog.status, FIRST_ERROR_STATUS));
  if (filter.keyId) list.push(eq(apiRequestLog.apiKeyId, filter.keyId));
  return list;
}

export async function listApiRequestLog(
  ctx: CoreConfig,
  actor: Actor,
  filter: ApiRequestLogFilter = {},
): Promise<readonly ApiRequestLogEntry[]> {
  const merchantId = requireMerchant(actor);
  const where = conditions(merchantId, filter);
  if (filter.after) {
    /*
     * Пара «время и номер» разложена на два условия, а не сравнивается
     * кортежем: у кортежа с `bigint` Postgres не выводит тип второго
     * параметра, и драйвер отправлял дату строкой.
     */
    // Номер приходит снаружи строкой: не число — отказ словами, а не
    // исключение `BigInt` и пятисотый.
    if (!/^\d+$/.test(filter.after.id)) {
      throw new InvalidInputError('Курсор журнала: afterId — номер строки из прошлого ответа');
    }
    const afterId = BigInt(filter.after.id);
    where.push(
      or(
        lt(apiRequestLog.at, filter.after.at),
        and(eq(apiRequestLog.at, filter.after.at), lt(apiRequestLog.id, afterId)),
      )!,
    );
  }

  const rows = await ctx.db
    .select({
      id: apiRequestLog.id,
      keyId: apiRequestLog.apiKeyId,
      keyLabel: apiKeys.label,
      keyHint: apiKeys.hint,
      method: apiRequestLog.method,
      path: apiRequestLog.path,
      status: apiRequestLog.status,
      durationMs: apiRequestLog.durationMs,
      address: apiRequestLog.address,
      error: apiRequestLog.error,
      at: apiRequestLog.at,
    })
    .from(apiRequestLog)
    .innerJoin(apiKeys, eq(apiKeys.id, apiRequestLog.apiKeyId))
    .where(and(...where))
    .orderBy(desc(apiRequestLog.at), desc(apiRequestLog.id))
    .limit(Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT));

  return rows.map((row) => ({ ...row, id: row.id.toString() }));
}

export async function countApiRequestLog(
  ctx: CoreConfig,
  actor: Actor,
  filter: Omit<ApiRequestLogFilter, 'limit' | 'after'> = {},
): Promise<number> {
  const merchantId = requireMerchant(actor);
  const [row] = await ctx.db
    .select({ total: count() })
    .from(apiRequestLog)
    .where(and(...conditions(merchantId, filter)));
  return row?.total ?? 0;
}

/**
 * Плитки над журналом: сколько вызовов, сколько из них отказов, среднее
 * время ответа. Одним запросом: три запроса «сколько там» ходили бы за
 * одним и тем же.
 */
export async function summarizeApiRequestLog(
  ctx: CoreConfig,
  actor: Actor,
  period: { readonly since: Date },
): Promise<ApiRequestLogSummary> {
  const merchantId = requireMerchant(actor);
  const [row] = await ctx.db
    .select({
      total: count(),
      failed: sql`count(*) filter (where ${apiRequestLog.status} >= ${FIRST_ERROR_STATUS})`.mapWith(
        Number,
      ),
      durationSum: sql`coalesce(sum(${apiRequestLog.durationMs}), 0)`.mapWith(Number),
    })
    .from(apiRequestLog)
    .where(and(eq(apiRequestLog.merchantId, merchantId), gte(apiRequestLog.at, period.since)));

  const total = row?.total ?? 0;
  const failed = row?.failed ?? 0;
  const durationSum = row?.durationSum ?? 0;

  return {
    total,
    ok: total - failed,
    failed,
    averageDurationMs: total === 0 ? null : Math.round(durationSum / total),
  };
}

/**
 * Чистка по сроку. Без исполнителя: зовёт её планировщик, и защищает
 * вызов общий секрет маршрута, а не права в ядре — как у отмены
 * просроченных заявок. Возвращает, сколько убрано, чтобы прогон
 * планировщика был виден в его журнале строкой с числом.
 */
export async function purgeApiRequestLog(ctx: CoreConfig, olderThan: Date): Promise<number> {
  const deleted = await ctx.db
    .delete(apiRequestLog)
    .where(lt(apiRequestLog.at, olderThan))
    .returning({ id: apiRequestLog.id });
  return deleted.length;
}

