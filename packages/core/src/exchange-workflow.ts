import {
  and,
  asc,
  count,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  clientRequisites,
  clients,
  currencies,
  exchangeRequestEvents,
  exchangeRequests,
  staff,
} from '@nemo/db';
import {
  canTransition,
  inProgressExchangeStatuses,
  Money,
  payoutMethodOf,
  type ActorType,
  type Amount,
  type ExchangeKind,
  type ExchangeRequestStatus,
} from '@nemo/types';
import { requireClient, requireStaff, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { requirePositiveAmount } from './amounts.js';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  TransitionNotAllowedError,
} from './errors.js';
import { toExchangeRequestView, type ExchangeRequestView } from './exchange-requests.js';
import type { Notification } from './notifications.js';
import { accrueReferralBonuses } from './referral-accruals.js';
import { readFeeSchedule } from './fee-schedules.js';
import { describeServiceAccount, issueServiceAccount } from './service-accounts.js';
import { readServiceSettings } from './settings.js';

/**
 * Путь заявки на обмен от очереди до исполнения.
 *
 * Смена состояния, запись в историю и уведомление клиента — одна
 * операция и одна транзакция. Разделять их нельзя: заявка, у которой
 * поменялся статус, но не появилось события, оставляет спорный обмен
 * без следов, а исполнение без начисления баллов тихо обворовывает
 * реферера.
 *
 * Разрешённые переходы заданы в `@nemo/types` таблицей. Всё, чего в ней
 * нет, отвергается — «на всякий случай» здесь ничего не разрешается.
 */

/**
 * Заявка на обмен глазами менеджера: с доходом по заявке и тем, кто её ведёт.
 * Клиенту это представление не отдаётся.
 */
export interface ManagerExchangeRequestView extends ExchangeRequestView {
  readonly assignedManagerId: string | null;
  readonly serviceIncome: Amount | null;
  readonly serviceIncomeCode: string | null;
  /**
   * Какой счёт сервиса выдали клиенту (docs/adr/0008). Ссылка, а не
   * копия: погашение счёта прошлых заявок не касается, а сам выданный
   * текст лежит рядом, в `paymentInstructions`.
   */
  readonly serviceAccountId: string | null;
  /**
   * Кто ведёт заявку — именем, а не идентификатором. Не поле заявки, а
   * подпись к ней: «заявку ведёт 5f3c…» не отличает коллегу от себя, а
   * «Анна» отличает.
   */
  readonly assignedManagerName: string | null;
  /**
   * Ник клиента. Не поле заявки, а подпись к ней: в очереди из десятка
   * строк «клиент 379336096» не отличается от соседнего номера, а
   * «@elfuertue» отличается.
   */
  readonly clientUsername: string | null;
}

export interface ExchangeRequestEventView {
  readonly fromStatus: ExchangeRequestStatus | null;
  readonly toStatus: ExchangeRequestStatus;
  readonly actorType: ActorType;
  readonly actorStaffId: string | null;
  readonly comment: string | null;
  readonly createdAt: Date;
}

export interface TransitionResult {
  readonly request: ManagerExchangeRequestView;
  readonly notifications: readonly Notification[];
}

/** То же, но для перехода, который выполнил клиент: без дохода по заявке. */
export interface ClientTransitionResult {
  readonly request: ExchangeRequestView;
  readonly notifications: readonly Notification[];
}

/** Внутренний результат перехода: строка, из которой строят нужное представление. */
interface AppliedTransition {
  readonly row: ExchangeRequestRow;
  readonly notifications: readonly Notification[];
}

type ExchangeRequestRow = typeof exchangeRequests.$inferSelect;

export function toManagerView(
  row: ExchangeRequestRow,
  clientUsername: string | null = null,
  assignedManagerName: string | null = null,
): ManagerExchangeRequestView {
  return {
    ...toExchangeRequestView(row),
    assignedManagerId: row.assignedManagerId,
    serviceIncome: row.serviceIncome === null ? null : Money.toAmount(row.serviceIncome),
    serviceIncomeCode: row.serviceIncomeCode,
    serviceAccountId: row.serviceAccountId,
    clientUsername,
    assignedManagerName,
  };
}

/**
 * Уведомление — следствие перехода, а не отдельное действие: так его
 * нельзя забыть, добавив новый переход.
 */
function notificationFor(
  row: ExchangeRequestRow,
  payWithinMinutes?: number,
): Notification {
  return {
    kind: 'exchange-request-status',
    to: row.clientId,
    requestId: row.id,
    status: row.status,
    ...(row.finalRate === null ? {} : { finalRate: Money.toAmount(row.finalRate) }),
    ...(row.paymentInstructions === null
      ? {}
      : { paymentInstructions: row.paymentInstructions }),
    // Срок называется там же, где реквизиты: до этого момента платить
    // некуда, и отсчёт не идёт.
    ...(row.status === 'rate_confirmed' && payWithinMinutes !== undefined
      ? { payWithinMinutes }
      : {}),
    ...(row.cancelReason === null ? {} : { cancelReason: row.cancelReason }),
  };
}

/**
 * Строка заявки, заблокированная до конца транзакции.
 *
 * Без блокировки два менеджера, нажавшие «взять» одновременно, оба
 * прочитали бы «новая» и оба записали бы себя исполнителем.
 */
async function lockRequest(
  executor: Executor,
  requestId: string,
): Promise<ExchangeRequestRow> {
  const [row] = await executor
    .select()
    .from(exchangeRequests)
    .where(eq(exchangeRequests.id, requestId))
    .limit(1)
    .for('update');

  if (!row) {
    throw new NotFoundError('Заявка на обмен не найдена');
  }
  return row;
}

/**
 * Заявку на обмен ведёт тот, кто её взял: клиенту звонит один человек и
 * курс называет тоже он. Невзятая заявка ничья — с ней работает любой
 * сотрудник.
 *
 * Обхода для администратора здесь нет. Заявка, застрявшая на уволенном
 * менеджере, — настоящая беда, но лечится она передачей заявки другому,
 * а не правом действовать поверх закрепления: иначе в истории окажется
 * два исполнителя, а закрепление останется за первым.
 */
function requireOwnership(row: ExchangeRequestRow, actor: Actor): string {
  // Не `staff`: этим именем в модуле называется таблица сотрудников, и
  // затенение её местной переменной читается как ошибка.
  const who = requireStaff(actor);
  if (row.assignedManagerId !== null && row.assignedManagerId !== who.staffId) {
    throw new ForbiddenError(
      'Заявку на обмен ведёт другой менеджер — напишите ему или ответьте клиенту в переписке',
    );
  }
  return who.staffId;
}

/**
 * Что переход дописывает в заявку помимо статуса. Перечислено поимённо:
 * с `Partial` от всей строки переход мог бы поменять и клиента, и
 * состояние в обход таблицы, и собственный идентификатор.
 */
type ExchangeRequestPatch = Partial<
  Pick<
    typeof exchangeRequests.$inferInsert,
    | 'assignedManagerId'
    | 'finalRate'
    | 'toAmount'
    | 'paymentInstructions'
    | 'serviceAccountId'
    | 'requisitesIssuedAt'
    | 'serviceIncome'
    | 'serviceIncomeCode'
    | 'cancelReason'
  >
>;

interface TransitionInput {
  readonly to: ExchangeRequestStatus;
  readonly actorType: ActorType;
  readonly actorStaffId?: string | undefined;
  readonly comment?: string | undefined;
  readonly patch?: ExchangeRequestPatch | undefined;
  /** Срок оплаты, если этот переход его открывает. */
  readonly payWithinMinutes?: number | undefined;
}

async function applyTransition(
  executor: Executor,
  row: ExchangeRequestRow,
  input: TransitionInput,
): Promise<AppliedTransition> {
  if (!canTransition(row.status, input.to)) {
    throw new TransitionNotAllowedError(
      `Из состояния «${row.status}» нельзя перейти в «${input.to}»`,
    );
  }

  const [updated] = await executor
    .update(exchangeRequests)
    .set({
      ...input.patch,
      status: input.to,
      updatedAt: new Date(),
      ...(input.to === 'completed' ? { completedAt: new Date() } : {}),
    })
    .where(eq(exchangeRequests.id, row.id))
    .returning();

  await executor.insert(exchangeRequestEvents).values({
    requestId: row.id,
    fromStatus: row.status,
    toStatus: input.to,
    actorType: input.actorType,
    actorStaffId: input.actorStaffId ?? null,
    comment: input.comment ?? null,
  });

  return {
    row: updated!,
    notifications: [notificationFor(updated!, input.payWithinMinutes)],
  };
}

/** Переход, выполненный сотрудником: наружу уходит его представление. */
async function staffTransition(
  executor: Executor,
  row: ExchangeRequestRow,
  input: TransitionInput,
): Promise<TransitionResult> {
  const applied = await applyTransition(executor, row, input);
  return { request: toManagerView(applied.row), notifications: applied.notifications };
}

/**
 * Чем сужают очередь.
 *
 * Один набор на оба списка: вопросы у менеджера к ним одни и те же — «а
 * что моё», «покажи наличные», «где заявка вот этого клиента», — и
 * второй набор правил разошёлся бы с первым.
 */
export interface ExchangeQueueFilter {
  /** Ник или номер клиента: по ним его и ищут, когда он написал в чат. */
  readonly query?: string | undefined;
  readonly status?: ExchangeRequestStatus | undefined;
  readonly kind?: ExchangeKind | undefined;
  /**
   * Чьи заявки показывать: свои, чужие или все.
   *
   * Три состояния, а не два: смена начинается с вопроса «что моё», а
   * продолжается вопросом «что у коллег» — и оба списка нужны рядом, но
   * не вперемешку. Один и тот же ряд, показанный дважды, читается как
   * две заявки.
   */
  readonly mine?: boolean | undefined;
  readonly limit?: number | undefined;
  /**
   * Откуда продолжать. Пара «время подачи и идентификатор», а не одно
   * время: две заявки, поданные в одну миллисекунду, курсор по времени
   * либо теряет, либо отдаёт дважды — и то и другое молча.
   */
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

/**
 * Сколько строк отдавать, если предел не назвали, и сколько максимум.
 *
 * Выборка без предела — это тысяча строк в один экран тогда, когда
 * сервис вырастет; заметить это заранее нельзя, потому что на десятке
 * заявок она работает прекрасно. Предел по умолчанию покрывает смену с
 * запасом, а потолок защищает от «дай всё» из адресной строки.
 */
const DEFAULT_QUEUE_LIMIT = 50;
const MAX_QUEUE_LIMIT = 200;

function queueLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_QUEUE_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_QUEUE_LIMIT);
}

/**
 * Условия сужения — общие для обоих списков.
 *
 * Поиск идёт по нику и по номеру: ник есть не у всех, а номер есть у
 * каждого, и клиент, написавший «что с моей заявкой», опознаётся то
 * одним, то другим. Регистр не важен — ник в Telegram пишут как
 * придётся.
 */
/**
 * Обезвредить знаки поиска по образцу.
 *
 * Процент и подчёркивание в `like` означают «что угодно», и набранный
 * человеком «100%» превратился бы в поиск всего, что начинается на сто.
 * Обратная косая экранируется первой — иначе ею же и обошли бы
 * экранирование.
 */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (sign) => `\\${sign}`);
}

function queueConditions(filter: ExchangeQueueFilter, staffId: string): SQL[] {
  const conditions: SQL[] = [];

  if (filter.status) {
    conditions.push(eq(exchangeRequests.status, filter.status));
  }
  if (filter.kind) {
    conditions.push(eq(exchangeRequests.kind, filter.kind));
  }
  if (filter.mine === true) {
    conditions.push(eq(exchangeRequests.assignedManagerId, staffId));
  }
  if (filter.mine === false) {
    // Ничья заявка тоже не моя: в списке «у коллег» она не потеряется,
    // хотя в работу такая попасть и не должна.
    conditions.push(
      or(
        ne(exchangeRequests.assignedManagerId, staffId),
        isNull(exchangeRequests.assignedManagerId),
      )!,
    );
  }

  const query = filter.query?.trim();
  if (query) {
    /*
     * Номер сравнивается целиком, а не подстрокой: клиент присылает его
     * целым, а «100» внутри «21005» — это чужая заявка, показанная в
     * ответ на точный вопрос. Ник ищется подстрокой и без учёта
     * регистра: его набирают по памяти и как придётся.
     *
     * Сравнение текстом, а не числом: запрос приходит из поля поиска, и
     * приведение к числу отказало бы на любом нецифровом.
     */
    const digits = /^\d+$/.test(query);
    conditions.push(
      or(
        ilike(clients.username, `%${likeEscape(query)}%`),
        ...(digits ? [sql`${exchangeRequests.clientId}::text = ${query}`] : []),
      )!,
    );
  }

  if (filter.after) {
    // Строго дальше пары «время, идентификатор»: порядок выборки такой
    // же, и граница страницы не двоится.
    conditions.push(
      or(
        gt(exchangeRequests.createdAt, filter.after.createdAt),
        and(
          eq(exchangeRequests.createdAt, filter.after.createdAt),
          gt(exchangeRequests.id, filter.after.id),
        ),
      )!,
    );
  }

  return conditions;
}

/**
 * Очередь и список в работе — одной выборкой с разным условием по
 * состоянию.
 *
 * Порядок «старые сверху» и там и там: это срок ожидания клиента, а не
 * свежесть новости. Имя ведущего берётся соединением со списком
 * сотрудников: в строке очереди «кто взял» отвечает на вопрос, ради
 * которого её иначе пришлось бы открыть.
 */
async function listQueue(
  ctx: CoreConfig,
  actor: Actor,
  status: SQL,
  filter: ExchangeQueueFilter,
): Promise<readonly ManagerExchangeRequestView[]> {
  const { staffId } = requireStaff(actor);
  const conditions = [status, ...queueConditions(filter, staffId)];

  const rows = await ctx.db
    .select({
      request: exchangeRequests,
      username: clients.username,
      managerName: staff.displayName,
    })
    .from(exchangeRequests)
    .innerJoin(clients, eq(clients.telegramUserId, exchangeRequests.clientId))
    .leftJoin(staff, eq(staff.id, exchangeRequests.assignedManagerId))
    .where(and(...conditions))
    .orderBy(asc(exchangeRequests.createdAt), asc(exchangeRequests.id))
    .limit(queueLimit(filter.limit));

  return rows.map((row) => toManagerView(row.request, row.username, row.managerName));
}

/**
 * Сколько строк в списке — считая и те, что не поместились в страницу.
 *
 * Отдельным запросом, а не длиной выборки: у выборки есть предел, и
 * счётчик по ней показывал бы «50» и на пятидесяти заявках, и на
 * пятистах. Счётчик, который врёт, хуже отсутствующего — по нему
 * решают, за что браться.
 */
async function countQueue(
  ctx: CoreConfig,
  actor: Actor,
  status: SQL,
  filter: ExchangeQueueFilter,
): Promise<number> {
  const { staffId } = requireStaff(actor);
  // Курсор к счёту отношения не имеет: он про место в странице, а счёт
  // про весь список.
  const { after: _after, limit: _limit, ...counted } = filter;
  const conditions = [status, ...queueConditions(counted, staffId)];

  const [row] = await ctx.db
    .select({ total: count() })
    .from(exchangeRequests)
    .innerJoin(clients, eq(clients.telegramUserId, exchangeRequests.clientId))
    .where(and(...conditions));

  return row?.total ?? 0;
}

export function countExchangeRequestQueue(
  ctx: CoreConfig,
  actor: Actor,
  filter: ExchangeQueueFilter = {},
): Promise<number> {
  return countQueue(ctx, actor, eq(exchangeRequests.status, 'new'), filter);
}

export function countExchangeRequestsInProgress(
  ctx: CoreConfig,
  actor: Actor,
  filter: ExchangeQueueFilter = {},
): Promise<number> {
  return countQueue(
    ctx,
    actor,
    inArray(exchangeRequests.status, inProgressExchangeStatuses),
    filter,
  );
}

/** Очередь: заявки, которых никто не взял. */
export async function listExchangeRequestQueue(
  ctx: CoreConfig,
  actor: Actor,
  filter: ExchangeQueueFilter = {},
): Promise<readonly ManagerExchangeRequestView[]> {
  return listQueue(ctx, actor, eq(exchangeRequests.status, 'new'), filter);
}

/**
 * Заявки, которые уже взяли, но ещё не закрыли.
 *
 * Без этого списка взятая заявка исчезает из интерфейса: из очереди она
 * ушла, а другого пути к её карточке нет — и назвать курс, отметить
 * оплату или исполнить её становится нечем. Тикет просит только
 * очередь, но очередь без этого списка работать не даёт.
 */
export async function listExchangeRequestsInProgress(
  ctx: CoreConfig,
  actor: Actor,
  filter: ExchangeQueueFilter = {},
): Promise<readonly ManagerExchangeRequestView[]> {
  return listQueue(
    ctx,
    actor,
    inArray(exchangeRequests.status, inProgressExchangeStatuses),
    filter,
  );
}

export async function getExchangeRequestForStaff(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<ManagerExchangeRequestView> {
  requireStaff(actor);
  const [row] = await ctx.db
    .select({
      request: exchangeRequests,
      username: clients.username,
      // Кто ведёт — именем: карточка чужой заявки говорит менеджеру,
      // к кому идти, а «ведёт 5f3c…» не говорит ничего.
      managerName: staff.displayName,
    })
    .from(exchangeRequests)
    .innerJoin(clients, eq(clients.telegramUserId, exchangeRequests.clientId))
    .leftJoin(staff, eq(staff.id, exchangeRequests.assignedManagerId))
    .where(eq(exchangeRequests.id, requestId))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Заявка на обмен не найдена');
  }
  return toManagerView(row.request, row.username, row.managerName);
}

/**
 * Назначена ли цена этой заявки сеткой ступеней, а не наценкой.
 *
 * Нужно одной подсказке — той, что предлагает менеджеру доход по
 * заявке. Считает она его из наценки, вынимая её из курса, и там, где
 * курс пришёл от сетки, наценки в нём нет вовсе: посчитанное по ней
 * число было бы выдумкой, поданной как расчёт. А доход — база
 * реферальных начислений (docs/adr/0003), и поправить его потом нельзя.
 *
 * Отдельной операцией, а не полем заявки: в очереди подсказки нет, и
 * платить за неё запросом на каждую строку списка не за что. Своей
 * копии правила «какой сеткой считается заявка» здесь тоже нет — способ
 * выдачи выводится ровно так же, как при подаче.
 */
export async function isRequestPricedBySchedule(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<boolean> {
  requireStaff(actor);

  const [row] = await ctx.db
    .select({
      kind: exchangeRequests.kind,
      toCode: exchangeRequests.toCode,
      requestRate: exchangeRequests.requestRate,
      requisiteKind: clientRequisites.kind,
      promptpayIdType: clientRequisites.promptpayIdType,
    })
    .from(exchangeRequests)
    .leftJoin(clientRequisites, eq(clientRequisites.id, exchangeRequests.requisitesId))
    .where(eq(exchangeRequests.id, requestId))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Заявка на обмен не найдена');
  }

  // Курса подачи нет — цену назвал менеджер, и наценки в ней нет тем
  // более: подсказка молчит и без сетки.
  if (row.requestRate === null) return false;

  const payoutMethod =
    row.kind === 'cash'
      ? 'cash'
      : row.requisiteKind === null
        ? 'bank'
        : payoutMethodOf({ kind: row.requisiteKind, promptpayIdType: row.promptpayIdType });

  return (await readFeeSchedule(ctx.db, row.toCode, payoutMethod)) !== null;
}

export async function listExchangeRequestEvents(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<readonly ExchangeRequestEventView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select()
    .from(exchangeRequestEvents)
    .where(eq(exchangeRequestEvents.requestId, requestId))
    .orderBy(asc(exchangeRequestEvents.createdAt), asc(exchangeRequestEvents.id));

  return rows.map((row) => ({
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorType: row.actorType,
    actorStaffId: row.actorStaffId,
    comment: row.comment,
    createdAt: row.createdAt,
  }));
}

export async function claimExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<TransitionResult> {
  const staff = requireStaff(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    // Отдельный ответ вместо общего «переход запрещён»: менеджеру важно
    // понимать, что заявку не потеряли, а просто взял коллега. Про
    // отменённую и исполненную так сказать нельзя — их разбирает общая
    // таблица переходов, иначе отказ вводил бы в заблуждение.
    if (row.assignedManagerId !== null && row.status === 'in_progress') {
      throw new ConflictError(
        'Заявку на обмен уже взяли в работу — обновите список, она ушла к коллеге',
      );
    }

    return staffTransition(tx, row, {
      to: 'in_progress',
      actorType: 'manager',
      actorStaffId: staff.staffId,
      patch: { assignedManagerId: staff.staffId },
    });
  });
}

export interface ConfirmExchangeRateInput {
  /**
   * Курс, который называет менеджер. Только у заявки без курса подачи —
   * наличной или поданной при молчащем источнике котировок. У
   * безналичной заявки курс уже назван при подаче, и менять его
   * менеджер не может.
   */
  readonly finalRate?: string | undefined;
  /** Сколько клиент получит по названному курсу. */
  readonly toAmount?: string | undefined;
  /**
   * Счёт сервиса, который выдают клиенту (docs/adr/0008). Реквизиты по
   * нему собирает ядро: менеджер выбирает счёт, а не набирает номер.
   */
  readonly serviceAccountId?: string | undefined;
  /**
   * Что менеджер дописывает к выданному: срок, условие, сумма. У
   * наличной заявки счёта нет вовсе, и это единственное, что уходит
   * клиенту, — там менеджер называет место и время.
   */
  readonly paymentInstructions?: string | undefined;
}

/**
 * Курс, по которому пойдёт сделка.
 *
 * Курс подачи — обязательство сервиса (docs/adr/0006): подтверждение
 * его не меняет. Менеджер называет свой только там, где курса нет
 * вовсе, — у наличных и у заявки, поданной при молчащем источнике.
 *
 * Присланный поверх курса подачи отвергается, а не игнорируется молча:
 * менеджер, набравший другое число, должен узнать, что сделка пойдёт не
 * по нему, — иначе он назовёт клиенту цену, которой не будет.
 */
function rateForConfirmation(
  row: ExchangeRequestRow,
  input: ConfirmExchangeRateInput,
): Amount {
  const named =
    input.finalRate === undefined
      ? undefined
      : requirePositiveAmount(input.finalRate, 'Курс');

  if (row.requestRate === null) {
    if (named === undefined) {
      throw new InvalidInputError(
        'У этой заявки нет курса подачи — наличная или подана при молчащем источнике. ' +
          'Назовите курс, по которому исполняете',
      );
    }
    return named;
  }

  const requestRate = Money.toAmount(row.requestRate);
  if (named !== undefined && Money.compare(named, requestRate) !== 0) {
    throw new InvalidInputError(
      `Курс заявки — обязательство сервиса и не меняется: ${requestRate}`,
    );
  }
  return requestRate;
}

export async function confirmExchangeRate(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
  input: ConfirmExchangeRateInput,
): Promise<TransitionResult> {
  const named =
    input.toAmount === undefined
      ? undefined
      : requirePositiveAmount(input.toAmount, 'Сумма к выдаче');
  const note = input.paymentInstructions?.trim() ?? '';

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);

    /*
     * Куда платить, зависит от вида сделки, и правило это держит ядро, а
     * не форма: операцию зовут не только с экрана выдачи, а набранный
     * руками номер — это перевод, который не возвращается
     * (docs/adr/0008). Правило, живущее в разметке, обходится любым
     * другим путём к операции.
     */
    if (row.kind === 'cash') {
      // Наличная сделка идёт из рук в руки: счёта у неё нет по
      // устройству, и предложенный означал бы перепутанную заявку.
      if (input.serviceAccountId !== undefined) {
        throw new InvalidInputError(
          'У наличной заявки счёта нет: назовите место и время словами',
        );
      }
      if (!note) {
        throw new InvalidInputError('Назовите, где и когда клиент получит наличные');
      }
    } else if (input.serviceAccountId === undefined) {
      throw new InvalidInputError(
        'Выберите счёт сервиса: реквизиты для оплаты не набираются руками',
      );
    }

    /*
     * Реквизиты собирает ядро, а не менеджер. Валюта сверяется с той,
     * которой платит клиент, — то есть с отдаваемой стороной заявки.
     */
    const issued =
      input.serviceAccountId === undefined
        ? undefined
        : await issueServiceAccount(ctx, tx, input.serviceAccountId, row.fromCode);
    const paymentInstructions = [issued?.instructions, note]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');
    const finalRate = rateForConfirmation(row, input);
    // У заявки с курсом подачи сумма к выдаче посчитана при подаче —
    // клиент видел её в калькуляторе. Присланная поверх отвергается по
    // той же причине, что и чужой курс: менеджер должен узнать, что
    // сделка пойдёт не по названной им сумме, раньше клиента.
    if (row.requestRate !== null && named !== undefined) {
      throw new InvalidInputError(
        'Сумма к выдаче посчитана по курсу заявки и не меняется',
      );
    }
    const toAmount = row.requestRate === null ? named : undefined;
    const { unpaidExchangeRequestTtlMinutes } = await readServiceSettings(tx);

    return staffTransition(tx, row, {
      to: 'rate_confirmed',
      payWithinMinutes: unpaidExchangeRequestTtlMinutes,
      actorType: 'manager',
      actorStaffId: staffId,
      // Какой счёт выдан — в историю заявки, а не только колонкой:
      // колонку читает выборка, а историю читает человек, который
      // разбирает спорный обмен через месяц.
      ...(issued === undefined
        ? {}
        : { comment: `Выдан счёт: ${describeServiceAccount(issued.account)}` }),
      patch: {
        finalRate,
        paymentInstructions,
        ...(issued === undefined ? {} : { serviceAccountId: issued.account.id }),
        // Момент, с которого клиент впервые мог заплатить: от него и
        // считается срок жизни неоплаченной заявки.
        requisitesIssuedAt: new Date(),
        ...(toAmount === undefined ? {} : { toAmount }),
      },
    });
  });
}

export async function markPaymentReceived(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<TransitionResult> {
  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);

    return staffTransition(tx, row, {
      to: 'payment_received',
      actorType: 'manager',
      actorStaffId: staffId,
    });
  });
}

export interface CompleteExchangeRequestInput {
  /** Сколько сервис заработал на этой заявке — база реферальных начислений. */
  readonly serviceIncome: string;
  readonly serviceIncomeCode: string;
}

export async function completeExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
  input: CompleteExchangeRequestInput,
): Promise<TransitionResult> {
  const serviceIncome = requirePositiveAmount(input.serviceIncome, 'Доход по заявке');
  const serviceIncomeCode = input.serviceIncomeCode.trim();
  if (!serviceIncomeCode) {
    throw new InvalidInputError('Укажите валюту дохода по заявке');
  }

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);
    await requireKnownCurrency(tx, serviceIncomeCode);

    const applied = await applyTransition(tx, row, {
      to: 'completed',
      actorType: 'manager',
      actorStaffId: staffId,
      patch: { serviceIncome, serviceIncomeCode },
    });

    // Начисление — часть той же транзакции, что и смена статуса: откат
    // одного откатывает другое. Разделить их значило бы допустить
    // исполненную заявку без начислений — и обнаружить это, когда
    // реферер спросит, куда делись его баллы.
    const accrued = await accrueReferralBonuses(tx, {
      requestId: row.id,
      clientId: row.clientId,
      serviceIncome,
    });

    return {
      request: toManagerView(applied.row),
      notifications: [...applied.notifications, ...accrued],
    };
  });
}

/**
 * Отмена клиентом — единственный переход, который он может выполнить, и
 * только пока заявку никто не взял. Дальше в работе участвует менеджер,
 * и бросать её на полпути клиент не может.
 *
 * Отдельная операция от менеджерской, а не общая с проверкой роли
 * внутри: у них разные правила — клиент не объясняется, менеджер обязан
 * назвать причину, — и, главное, разный ответ. Клиенту уходит его
 * представление заявки, в котором дохода по заявке нет вовсе; общая
 * операция вернула бы менеджерское, и не забыть про это пришлось бы
 * каждому маршруту.
 */
export async function cancelOwnExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<ClientTransitionResult> {
  const clientId = requireClient(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    if (row.clientId !== clientId) {
      throw new NotFoundError('Заявка на обмен не найдена');
    }
    if (row.status !== 'new') {
      throw new TransitionNotAllowedError(
        'Заявку на обмен уже взяли в работу — отменить её может только менеджер',
      );
    }

    const result = await applyTransition(tx, row, { to: 'cancelled', actorType: 'client' });
    return { request: toExchangeRequestView(result.row), notifications: result.notifications };
  });
}

/** Отмена менеджером: из любого незавершённого состояния и с причиной. */
export async function cancelExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
  input: { reason?: string | undefined } = {},
): Promise<TransitionResult> {
  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    const staffId = requireOwnership(row, actor);
    const reason = input.reason?.trim();
    if (!reason) {
      // Клиент должен понимать, что произошло: отмена без причины
      // оставляет его гадать, а сервис — без объяснений в споре.
      throw new InvalidInputError('Укажите причину отмены');
    }

    return staffTransition(tx, row, {
      to: 'cancelled',
      actorType: 'manager',
      actorStaffId: staffId,
      comment: reason,
      patch: { cancelReason: reason },
    });
  });
}

/**
 * Валюта дохода сверяется со справочником, а не принимается как есть:
 * от неё считаются реферальные начисления, и «RUR» вместо «RUB»
 * означало бы вторую валюту, в которой у клиента копится отдельный, ни
 * с чем не сходящийся остаток.
 */
async function requireKnownCurrency(executor: Executor, code: string): Promise<void> {
  const [row] = await executor
    .select({ code: currencies.code })
    .from(currencies)
    .where(eq(currencies.code, code))
    .limit(1);

  if (!row) {
    throw new InvalidInputError(`Валюта ${code} не заведена в справочнике`);
  }
}
