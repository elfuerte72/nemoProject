import { createHmac, randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { merchants, webhookDeliveries, webhookEndpoints } from '@nemo/db';
import {
  isWebhookEvent,
  webhookEventForStatus,
  webhookEvents,
  type ExchangeRequestStatus,
  type WebhookDeliveryStatus,
  type WebhookEndpointState,
  type WebhookEvent,
} from '@nemo/types';
import { requireMerchantAbility, requireStaff, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import { merchantOwnerRecipient, requireActiveMerchant } from './merchants.js';
import type { Notification } from './notifications.js';
import { randomAlphanumeric } from './secrets.js';

/**
 * Вебхуки мерчанта — исходящая очередь в базе (docs/adr/0018).
 *
 * Мерчант называет адрес и события; сервис при каждом переходе его
 * заявки кладёт строку доставки в ту же транзакцию, что и сам переход,
 * а воркер кабинета забирает строки и шлёт `POST` с подписью. Тело
 * тонкое — `id`, тип, номер заявки, состояние, время: подробности
 * мерчант забирает по API, и реквизиты в чужие журналы доставок не
 * попадают.
 *
 * Порядок не гарантируется и дубли возможны — повтор после обрыва
 * связи уходит байт в байт, с тем же `id`. Приёмник обязан опираться
 * на `id`, и подсказка «как встроить» говорит об этом прямо.
 */

/** Имена событий живут в `@nemo/types`: их читает и форма кабинета. */
export const WEBHOOK_EVENTS = webhookEvents;
export type { WebhookDeliveryStatus, WebhookEndpointState, WebhookEvent };

/** Паузы между попытками: после первой неудачи минута, после четвёртой час. */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 15, 60] as const;
/** Пятая неудача — провал: письмо мерчанту и отметка у точки. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_MINUTES.length + 1;
/** Сколько приёмнику дают на ответ. */
export const WEBHOOK_TIMEOUT_MS = 10_000;
/**
 * На сколько строка уходит воркеру. Процесс, упавший посреди отправки,
 * строку не вернёт — её заберут снова, когда лизинг истечёт.
 */
export const WEBHOOK_LEASE_MS = 2 * 60_000;
/** Сколько знаков ответа приёмника хранится: по ним видно, чем он подавился. */
export const WEBHOOK_RESPONSE_CHARS = 500;

export interface WebhookEndpointView {
  readonly id: string;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  readonly pausedAt: Date | null;
  readonly failingSince: Date | null;
  /** Одно из трёх состояний: «не отвечает» старше паузы. */
  readonly state: WebhookEndpointState;
  readonly createdAt: Date;
  /** Сколько доставок было всего и чем кончилась последняя. */
  readonly deliveries: number;
  readonly lastDelivery: { readonly at: Date; readonly status: WebhookDeliveryStatus } | null;
}

export interface AddedWebhookEndpoint {
  readonly endpoint: WebhookEndpointView;
  /** Секрет для проверки подписи. Отдаётся однажды — здесь. */
  readonly secret: string;
}

export interface WebhookDeliveryView {
  readonly id: string;
  readonly endpointId: string;
  readonly endpointUrl: string;
  readonly event: WebhookEvent;
  readonly requestId: string | null;
  readonly body: string;
  readonly status: WebhookDeliveryStatus;
  readonly attempt: number;
  readonly nextAttemptAt: Date;
  readonly responseStatus: number | null;
  readonly responseBody: string | null;
  readonly durationMs: number | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
}

/** Что воркеру слать: адрес, секрет для подписи и тело как есть. */
export interface WebhookJob {
  readonly deliveryId: string;
  readonly url: string;
  readonly secret: string;
  readonly body: string;
  readonly event: WebhookEvent;
  /** Номер этой попытки, считая с единицы. */
  readonly attempt: number;
}

export type WebhookDeliveryResult =
  | {
      readonly ok: true;
      readonly responseStatus: number;
      readonly responseBody: string;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly responseStatus?: number | undefined;
      readonly responseBody?: string | undefined;
      readonly error: string;
      readonly durationMs: number;
    };

/**
 * Одноразовые приёмники: адрес на них живёт часы, и доставка туда
 * означает, что через неделю сервис шлёт события в пустоту, а мерчант
 * жалуется, что вебхуки «не приходят». Для проверки есть «пробное».
 */
const DISPOSABLE_HOSTS = [
  'webhook.site',
  'requestbin.com',
  'pipedream.net',
  'beeceptor.com',
  'hookbin.com',
  'requestcatcher.com',
  'webhook-test.com',
  'typedwebhook.tools',
];

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp'];

export type WebhookUrlCheck = { readonly ok: true } | { readonly ok: false; readonly complaint: string };

function isIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(':');
}

/**
 * Адрес точки — только `https` на публичный хост.
 *
 * Внутренние сети и `localhost` снаружи недостижимы, а ещё это адрес,
 * по которому сервис ходит сам: принять «https://10.0.0.5/admin»
 * значило бы дать мерчанту стучаться нашими руками во внутреннюю сеть
 * сервиса. Здесь проверяется имя; куда оно указывает, проверяет воркер
 * перед каждой отправкой — имя разрешается в адрес, и внутренний адрес
 * отвергается там. Досягаемость не проверяется: ответит ли приёмник,
 * скажет пробная доставка.
 */
export function looksLikeWebhookUrl(value: string): WebhookUrlCheck {
  const no = (complaint: string): WebhookUrlCheck => ({ ok: false, complaint });

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return no('Адрес не разобран: нужен полный, вида https://shop.example/hooks/tobee');
  }
  if (url.protocol !== 'https:') {
    return no('Только https: по http тело и подпись читает любой посредник по дороге');
  }
  if (url.username || url.password) {
    return no('Логин и пароль в адресе не принимаются: для проверки подлинности есть подпись секретом');
  }

  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host)) {
    return no('Адрес по имени хоста, а не по IP: сертификат https выдаётся на имя');
  }
  if (host === 'localhost' || !host.includes('.') || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return no('Нужен публичный хост: localhost и внутренние имена снаружи недостижимы');
  }
  if (DISPOSABLE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))) {
    return no(
      'Одноразовый приёмник не принимается: заведите свой адрес, а проверить доставку можно кнопкой «пробное»',
    );
  }
  return { ok: true };
}

/** Заголовок `x-webhook-signature`: HMAC-SHA256 секрета от тела как есть. */
export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}


const SECRET_LENGTH = 32;
const MAX_URL = 500;

type EndpointRow = typeof webhookEndpoints.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

export async function addWebhookEndpoint(
  ctx: CoreConfig,
  actor: Actor,
  input: { readonly url: string; readonly events: readonly WebhookEvent[] },
): Promise<AddedWebhookEndpoint> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');

  const url = input.url.trim();
  const check = looksLikeWebhookUrl(url);
  if (!check.ok) throw new InvalidInputError(check.complaint);
  if (url.length > MAX_URL) throw new InvalidInputError(`Адрес: не длиннее ${MAX_URL} знаков`);

  const events = [...new Set(input.events)];
  if (events.length === 0) {
    throw new InvalidInputError('Отметьте хотя бы одно событие: точка без событий ничего не получит');
  }
  const unknown = events.find((one) => !isWebhookEvent(one));
  if (unknown !== undefined) {
    throw new InvalidInputError(`Событие «${unknown}» неизвестно: бывают ${WEBHOOK_EVENTS.join(', ')}`);
  }

  // Точку заводит одобренный и не отключённый: она — обещание слать
  // события о заявках, а подавать их отключённому нельзя.
  await requireActiveMerchant(ctx.db, merchantId);

  const secret = `whsec_${randomAlphanumeric(SECRET_LENGTH)}`;
  const [row] = await ctx.db
    .insert(webhookEndpoints)
    .values({ merchantId, url, secret, events })
    .returning();

  return {
    endpoint: toEndpointView(row!, { deliveries: 0, lastDelivery: null }),
    secret,
  };
}

function toEndpointView(
  row: EndpointRow,
  stats: { deliveries: number; lastDelivery: WebhookEndpointView['lastDelivery'] },
): WebhookEndpointView {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    pausedAt: row.pausedAt,
    failingSince: row.failingSince,
    state: row.failingSince ? 'failing' : row.pausedAt ? 'paused' : 'active',
    createdAt: row.createdAt,
    deliveries: stats.deliveries,
    lastDelivery: stats.lastDelivery,
  };
}

async function endpointViews(
  ctx: CoreConfig,
  rows: readonly EndpointRow[],
): Promise<readonly WebhookEndpointView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const counts = await ctx.db
    .select({ endpointId: webhookDeliveries.endpointId, total: count() })
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.endpointId, ids))
    .groupBy(webhookDeliveries.endpointId);

  const last = await ctx.db
    .selectDistinctOn([webhookDeliveries.endpointId], {
      endpointId: webhookDeliveries.endpointId,
      status: webhookDeliveries.status,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.endpointId, ids))
    .orderBy(webhookDeliveries.endpointId, desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id));

  const totals = new Map(counts.map((one) => [one.endpointId, one.total]));
  const lasts = new Map(
    last.map((one) => [one.endpointId, { at: one.createdAt, status: one.status }]),
  );
  return rows.map((row) =>
    toEndpointView(row, {
      deliveries: totals.get(row.id) ?? 0,
      lastDelivery: lasts.get(row.id) ?? null,
    }),
  );
}

export async function listWebhookEndpoints(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly WebhookEndpointView[]> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  return endpointViews(ctx, await liveEndpointsOf(ctx, merchantId));
}

/** Точки мерчанта для карточки в панели: здоровье доставок, без секретов. */
export async function listMerchantWebhookEndpoints(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
): Promise<readonly WebhookEndpointView[]> {
  requireStaff(actor);
  return endpointViews(ctx, await liveEndpointsOf(ctx, merchantId));
}

async function liveEndpointsOf(ctx: CoreConfig, merchantId: string): Promise<EndpointRow[]> {
  return ctx.db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.merchantId, merchantId), eq(webhookEndpoints.isActive, true)))
    .orderBy(asc(webhookEndpoints.createdAt), asc(webhookEndpoints.id));
}

async function ownEndpoint(executor: Executor, merchantId: string, endpointId: string): Promise<EndpointRow> {
  const [row] = await executor
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.merchantId, merchantId),
        eq(webhookEndpoints.isActive, true),
      ),
    )
    .limit(1);
  // Чужая точка — «не найдена»: иначе перебором можно узнать, какие есть.
  if (!row) throw new NotFoundError('Точка вебхука не найдена');
  return row;
}

/**
 * Пауза мерчантом. Новые события точке на паузе не пишутся, а уже
 * заведённые доставки ждут: после недели паузы на приёмник не
 * обрушится неделя событий, о которых мерчант давно узнал по API, но
 * и начатое не пропадёт.
 */
export async function setWebhookEndpointPaused(
  ctx: CoreConfig,
  actor: Actor,
  endpointId: string,
  paused: boolean,
): Promise<WebhookEndpointView> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  await ownEndpoint(ctx.db, merchantId, endpointId);
  const [updated] = await ctx.db
    .update(webhookEndpoints)
    .set({ pausedAt: paused ? new Date() : null })
    .where(eq(webhookEndpoints.id, endpointId))
    .returning();
  const [view] = await endpointViews(ctx, [updated!]);
  return view!;
}

/**
 * Удаление — гашение: строка остаётся ради истории доставок, а
 * ожидающие доставки закрываются провалом с причиной. Слать в удалённую
 * точку нельзя, и держать их в очереди было бы обманом воркера.
 */
export async function removeWebhookEndpoint(
  ctx: CoreConfig,
  actor: Actor,
  endpointId: string,
): Promise<void> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  await ctx.db.transaction(async (tx) => {
    await ownEndpoint(tx, merchantId, endpointId);
    await tx
      .update(webhookEndpoints)
      .set({ isActive: false })
      .where(eq(webhookEndpoints.id, endpointId));
    await tx
      .update(webhookDeliveries)
      .set({ status: 'failed', error: 'Точка удалена' })
      .where(
        and(eq(webhookDeliveries.endpointId, endpointId), eq(webhookDeliveries.status, 'pending')),
      );
  });
}

function toDeliveryView(row: DeliveryRow, endpointUrl: string): WebhookDeliveryView {
  return {
    id: row.id,
    endpointId: row.endpointId,
    endpointUrl,
    event: row.event,
    requestId: row.requestId,
    body: row.body,
    status: row.status,
    attempt: row.attempt,
    nextAttemptAt: row.nextAttemptAt,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    durationMs: row.durationMs,
    error: row.error,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
  };
}

const DELIVERIES_LIMIT = 50;
const DELIVERIES_MAX = 200;

/** Доставки мерчанта с адресом точки — одним запросом на список и на карточку. */
async function deliveriesOf(
  ctx: CoreConfig,
  merchantId: string,
  conditions: readonly SQL[],
  limit: number,
): Promise<readonly WebhookDeliveryView[]> {
  const rows = await ctx.db
    .select({ delivery: webhookDeliveries, url: webhookEndpoints.url })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(and(eq(webhookEndpoints.merchantId, merchantId), ...conditions))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(limit);
  return rows.map((row) => toDeliveryView(row.delivery, row.url));
}

/**
 * Последние доставки мерчанта — свежие первыми, с ответом приёмника; по
 * одной точке или по одной заявке, если названы.
 *
 * Отбор по заявке — для её карточки: там доставки стоят под сменами
 * состояния, и это вторая половина истории — узнала ли о переходе
 * система мерчанта. Отдельной операции под это нет намеренно: право то
 * же (`integration`), вид тот же, и вторая выборка тех же строк
 * разошлась бы с первой. Чужая заявка отвечает пустотой — точки-то
 * свои, — и существования её не подтверждает.
 */
export async function listWebhookDeliveries(
  ctx: CoreConfig,
  actor: Actor,
  filter: {
    readonly endpointId?: string | undefined;
    readonly requestId?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
): Promise<readonly WebhookDeliveryView[]> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  const conditions: SQL[] = [];
  if (filter.endpointId) conditions.push(eq(webhookDeliveries.endpointId, filter.endpointId));
  if (filter.requestId) conditions.push(eq(webhookDeliveries.requestId, filter.requestId));
  return deliveriesOf(
    ctx,
    merchantId,
    conditions,
    Math.min(filter.limit ?? DELIVERIES_LIMIT, DELIVERIES_MAX),
  );
}

export async function getWebhookDelivery(
  ctx: CoreConfig,
  actor: Actor,
  deliveryId: string,
): Promise<WebhookDeliveryView> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  const [found] = await deliveriesOf(ctx, merchantId, [eq(webhookDeliveries.id, deliveryId)], 1);
  if (!found) throw new NotFoundError('Доставка не найдена');
  return found;
}

/**
 * Тело события — тонкое и одно на всех: `id` доставки, тип, номер
 * заявки, её состояние и время перехода. Больше в нём нет ничего
 * намеренно: подробности мерчант забирает по API, а суммы и реквизиты
 * в чужих журналах доставок делать нечего.
 *
 * Отдельной функцией, а не строкой внутри вставки, потому что это же
 * тело показывает кабинет в примерах на странице «как встроить».
 * Пример, набранный руками, проверял бы представление о формате, а не
 * формат: разошлись бы они молча и в первую же правку.
 */
export function webhookEventBody(input: {
  readonly id: string;
  readonly event: WebhookEvent;
  readonly requestId: string | null;
  readonly status: ExchangeRequestStatus | null;
  readonly at: Date;
}): string {
  return JSON.stringify({
    id: input.id,
    type: input.event,
    requestId: input.requestId,
    status: input.status,
    at: input.at.toISOString(),
  });
}

function deliveryRow(input: {
  endpointId: string;
  event: WebhookEvent;
  requestId: string | null;
  status: ExchangeRequestStatus | null;
  at: Date;
}): typeof webhookDeliveries.$inferInsert {
  // Идентификатор события — сама строка: он уходит в тело, поэтому
  // берётся до вставки.
  const id = randomUUID();
  const body = webhookEventBody({ ...input, id });
  return {
    id,
    endpointId: input.endpointId,
    event: input.event,
    requestId: input.requestId,
    body,
    nextAttemptAt: input.at,
  };
}

/** Пробная доставка из кабинета: событие `ping`, заявки за ним нет. */
export async function enqueueWebhookPing(
  ctx: CoreConfig,
  actor: Actor,
  endpointId: string,
): Promise<WebhookDeliveryView> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  const endpoint = await ownEndpoint(ctx.db, merchantId, endpointId);
  const [row] = await ctx.db
    .insert(webhookDeliveries)
    .values(
      deliveryRow({ endpointId, event: 'ping', requestId: null, status: null, at: new Date() }),
    )
    .returning();
  return toDeliveryView(row!, endpoint.url);
}

/**
 * Строка доставки на переход заявки — в той транзакции, где переход и
 * случился. Заявка клиента вебхуков не порождает: точек у него не
 * бывает. Точке на паузе новых доставок не пишут: после недели паузы
 * на приёмник обрушилась бы неделя событий, о которых мерчант давно
 * узнал по API. Возвращает, сколько строк записано.
 */
export async function enqueueWebhookDeliveries(
  executor: Executor,
  request: {
    readonly id: string;
    readonly merchantId: string | null;
    readonly status: ExchangeRequestStatus;
  },
  at: Date = new Date(),
): Promise<number> {
  const event = webhookEventForStatus(request.status);
  if (event === undefined || request.merchantId === null) return 0;

  const targets = await executor
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.merchantId, request.merchantId),
        eq(webhookEndpoints.isActive, true),
        isNull(webhookEndpoints.pausedAt),
        sql`${event}::webhook_event = any(${webhookEndpoints.events})`,
      ),
    );
  if (targets.length === 0) return 0;

  await executor.insert(webhookDeliveries).values(
    targets.map((target) =>
      deliveryRow({
        endpointId: target.id,
        event,
        requestId: request.id,
        status: request.status,
        at,
      }),
    ),
  );
  return targets.length;
}

/**
 * Забрать доставки, у которых подошло время, — с адресом и секретом
 * точки.
 *
 * `for update skip locked`: два процесса не заберут одну строку, и
 * второй не ждёт первого. Забранная строка получает лизинг — срок
 * следующей попытки отодвигается на пару минут, и упавший посреди
 * отправки процесс её не теряет: истечёт лизинг — заберут снова.
 * Номер попытки растёт здесь же: попытка, оборванная падением, —
 * тоже попытка.
 */
export async function takeDueWebhookDeliveries(
  ctx: CoreConfig,
  options: {
    readonly now: Date;
    readonly limit: number;
    /** Только эта строка: так пробная доставка из кабинета берёт свою, а не чужую очередь. */
    readonly deliveryId?: string | undefined;
  },
): Promise<readonly WebhookJob[]> {
  return ctx.db.transaction(async (tx) => {
    const due = await tx
      .select({
        deliveryId: webhookDeliveries.id,
        body: webhookDeliveries.body,
        event: webhookDeliveries.event,
        attempt: webhookDeliveries.attempt,
        url: webhookEndpoints.url,
        secret: webhookEndpoints.secret,
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(
        and(
          eq(webhookDeliveries.status, 'pending'),
          lte(webhookDeliveries.nextAttemptAt, options.now),
          eq(webhookEndpoints.isActive, true),
          isNull(webhookEndpoints.pausedAt),
          ...(options.deliveryId ? [eq(webhookDeliveries.id, options.deliveryId)] : []),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.id))
      .limit(options.limit)
      .for('update', { of: webhookDeliveries, skipLocked: true });
    if (due.length === 0) return [];

    await tx
      .update(webhookDeliveries)
      .set({
        nextAttemptAt: new Date(options.now.getTime() + WEBHOOK_LEASE_MS),
        attempt: sql`${webhookDeliveries.attempt} + 1`,
      })
      .where(
        inArray(
          webhookDeliveries.id,
          due.map((one) => one.deliveryId),
        ),
      );

    return due.map((one) => ({
      deliveryId: one.deliveryId,
      url: one.url,
      secret: one.secret,
      body: one.body,
      event: one.event,
      attempt: one.attempt + 1,
    }));
  });
}

/**
 * Чем кончилась попытка. Удача закрывает доставку и снимает отметку с
 * точки; неудача назначает следующую попытку по расписанию, а пятая —
 * провал, отметка у точки и письмо. Письмо одно на приступ: пока
 * отметка стоит, второго нет — точка лежит, и сотня писем не поможет.
 */
export async function recordWebhookDeliveryResult(
  ctx: CoreConfig,
  deliveryId: string,
  result: WebhookDeliveryResult,
  now: Date = new Date(),
): Promise<{ readonly notifications: readonly Notification[] }> {
  return ctx.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(eq(webhookDeliveries.id, deliveryId))
      .limit(1)
      .for('update', { of: webhookDeliveries });
    if (!found) throw new NotFoundError('Доставка не найдена');
    // Уже закрыта — например, точку удалили, пока шла отправка.
    if (found.delivery.status !== 'pending') return { notifications: [] };

    const response = {
      responseStatus: result.responseStatus ?? null,
      responseBody: result.responseBody?.slice(0, WEBHOOK_RESPONSE_CHARS) ?? null,
      durationMs: Math.max(0, Math.round(result.durationMs)),
    };

    if (result.ok) {
      await tx
        .update(webhookDeliveries)
        .set({ ...response, status: 'delivered', deliveredAt: now, error: null })
        .where(eq(webhookDeliveries.id, deliveryId));
      await tx
        .update(webhookEndpoints)
        .set({ failingSince: null })
        .where(eq(webhookEndpoints.id, found.endpoint.id));
      return { notifications: [] };
    }

    const attempt = found.delivery.attempt;
    if (attempt < WEBHOOK_MAX_ATTEMPTS) {
      const wait = WEBHOOK_RETRY_MINUTES[attempt - 1] ?? WEBHOOK_RETRY_MINUTES[0];
      await tx
        .update(webhookDeliveries)
        .set({
          ...response,
          error: result.error,
          nextAttemptAt: new Date(now.getTime() + wait * 60_000),
        })
        .where(eq(webhookDeliveries.id, deliveryId));
      return { notifications: [] };
    }

    await tx
      .update(webhookDeliveries)
      .set({ ...response, status: 'failed', error: result.error })
      .where(eq(webhookDeliveries.id, deliveryId));

    /*
     * Отметка ставится условным изменением, а не «прочитал — записал»:
     * две доставки одной точки проваливаются разом — истечение срока
     * пачкой даёт им одно расписание, — и обе видели бы пустую отметку.
     * Письмо уходит с той, чьё изменение вернуло строку.
     */
    const [marked] = await tx
      .update(webhookEndpoints)
      .set({ failingSince: now })
      .where(and(eq(webhookEndpoints.id, found.endpoint.id), isNull(webhookEndpoints.failingSince)))
      .returning({ id: webhookEndpoints.id });
    if (!marked) return { notifications: [] };

    return {
      notifications: [
        {
          kind: 'merchant-webhook-failing',
          // Владельцу: вебхуки ведёт он, и встала интеграция его
          // организации.
          to: await merchantOwnerRecipient(tx, found.endpoint.merchantId),
          url: found.endpoint.url,
          event: found.delivery.event,
        },
      ],
    };
  });
}
