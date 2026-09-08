import { and, asc, count, desc, eq, inArray, lte, min, or, sql } from 'drizzle-orm';
import {
  bonusTransactions,
  clients,
  exchangeRequests,
  referralCodes,
  referrals,
  withdrawalRequests,
} from '@nemo/db';
import {
  Money,
  isReferralLine,
  isWithdrawalOpen,
  withdrawalRequestStatuses,
  type Amount,
  type ReferralCodeKind,
  type ReferralLine,
} from '@nemo/types';
import { requireClient, type Actor } from './actor.js';
import {
  DAY_MS,
  completedWithin,
  dayKey,
  localDayOf,
  localMidnight,
  periodOf,
  previousPeriod,
  requireOffset,
  requirePeriod,
  type AnalyticsPeriod,
  type MoneyByCurrency,
} from './analytics.js';
import type { CoreConfig } from './context.js';
import { InvalidInputError } from './errors.js';
import { activeReferralCodes } from './referral-codes.js';
import { readReferralProgram } from './referral-program.js';

/**
 * Реферальный кабинет клиента: сводка за период и список рефералов.
 *
 * Считается сервером и по правилам аналитики (docs/adr/0013): рефералы
 * «пришли» по дате привязки, «стали активными» по дате первой
 * исполненной заявки, «начислено» по дате начисления, «выплачено» по
 * дате списания; сравнение с равным периодом прямо перед выбранным;
 * валюты оборота не складываются. Столбики по дням — готовыми числами:
 * складывать суммы на телефоне значило бы везти `Money` в бандл ради
 * одной строки (`backlog.md`, «Прирост баллов за период»).
 *
 * Про самих рефералов — ни имени, ни ника, ни идентификатора: строка
 * списка говорит, когда пришёл и сколько принёс, но не кто это.
 */

export interface ReferralPeriodSummary {
  /** Пришло рефералов за период — по всем оплачиваемым линиям. */
  readonly joined: number;
  readonly joinedByLine: readonly { line: ReferralLine; count: number }[];
  /** Стали активными: первая исполненная заявка пришлась на период. */
  readonly activated: number;
  /** Начислено за период и сколько начислений. */
  readonly accrued: Amount;
  readonly accruals: number;
  /** Выплачено — списано по выплаченным заявкам за период. */
  readonly paid: Amount;
  /** Оборот приведённых по исполненным в период — по валюте отданной стороны. */
  readonly turnover: readonly MoneyByCurrency[];
}

export interface ReferralCabinetDay {
  /** День «2026-09-02» по местному времени того, кто смотрит. */
  readonly day: string;
  readonly joined: number;
  readonly accrued: Amount;
}

/** Код клиента со своей статистикой: кто по нему пришёл и что принёс первой линией. */
export interface ReferralCodeStats {
  readonly id: string;
  readonly code: string;
  readonly kind: ReferralCodeKind;
  readonly label: string;
  readonly joined: number;
  readonly accrued: Amount;
}

export interface ReferralCabinetStats {
  readonly period: AnalyticsPeriod;
  readonly current: ReferralPeriodSummary;
  readonly previous: ReferralPeriodSummary;
  /** Ждёт выплаты сейчас — сумма открытых заявок на вывод. */
  readonly pending: Amount;
  /** Пришли и начислено по дням за две недели до «сейчас», с нулями. */
  readonly byDay: readonly ReferralCabinetDay[];
  readonly codes: readonly ReferralCodeStats[];
}

export interface ReferralCabinetStatsOptions {
  readonly offsetMinutes?: number | undefined;
  readonly now?: Date | undefined;
}

/** Сколько дней в столбиках: две недели читаются одним взглядом. */
const BY_DAY_DAYS = 14;
/**
 * Длиннее года кабинету не нужно, а спрашивает его клиент, а не
 * сотрудник: у сводок панели предела нет, потому что их зовут свои.
 */
const MAX_PERIOD_MS = 366 * DAY_MS;
const OPEN_WITHDRAWAL_STATUSES = withdrawalRequestStatuses.filter(isWithdrawalOpen);
const within = periodOf;

/** Целое неотрицательное из запроса: `NaN` и бесконечность — отказ словами, а не ошибка базы. */
function requireWhole(value: number | undefined, fallback: number, subject: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidInputError(`${subject}: ожидается целое неотрицательное число`);
  }
  return Math.trunc(value);
}

function amountOf(value: string | null | undefined): Amount {
  return Money.toAmount(value ?? '0');
}

export async function summarizeReferralCabinet(
  ctx: CoreConfig,
  actor: Actor,
  period: AnalyticsPeriod,
  options: ReferralCabinetStatsOptions = {},
): Promise<ReferralCabinetStats> {
  const clientId = requireClient(actor);
  const current = requirePeriod(period);
  if (current.to.getTime() - current.from.getTime() > MAX_PERIOD_MS) {
    throw new InvalidInputError('Период — не длиннее года');
  }
  const previous = previousPeriod(current);
  const offset = requireOffset(options.offsetMinutes);
  const now = options.now ?? new Date();
  const tomorrow = new Date(localMidnight(now, offset).getTime() + DAY_MS);
  const window = { from: new Date(tomorrow.getTime() - BY_DAY_DAYS * DAY_MS), to: tomorrow };

  const program = await readReferralProgram(ctx.db);
  const mine = and(eq(referrals.referrerId, clientId), lte(referrals.line, program.depth))!;

  // Первая исполненная заявка каждого клиента — по ней реферал «стал активным».
  const firstCompleted = ctx.db
    .select({
      clientId: exchangeRequests.clientId,
      firstAt: min(exchangeRequests.completedAt).as('first_completed_at'),
    })
    .from(exchangeRequests)
    .where(eq(exchangeRequests.status, 'completed'))
    .groupBy(exchangeRequests.clientId)
    .as('first_completed');

  const [joined, activated, points, pending, turnover, joinedByDay, accruedByDay, codeJoins, codeAccruals, codes] =
    await Promise.all([
      ctx.db
        .select({
          line: referrals.line,
          n: sql`count(*) filter (where ${within(referrals.createdAt, current)})`.mapWith(Number),
          previous: sql`count(*) filter (where ${within(referrals.createdAt, previous)})`.mapWith(Number),
        })
        .from(referrals)
        .where(mine)
        .groupBy(referrals.line),
      // Колонка подзапроса не несёт маппинга типа, и объект `Date` в
      // сыром `sql` уехал бы `toString()`-ом — потому строкой ISO с явным
      // приведением, чтобы сравнение шло по времени, а не по буквам.
      ctx.db
        .select({
          n: sql`count(*) filter (where ${firstCompleted.firstAt} >= ${current.from.toISOString()}::timestamptz and ${firstCompleted.firstAt} < ${current.to.toISOString()}::timestamptz)`.mapWith(Number),
          previous: sql`count(*) filter (where ${firstCompleted.firstAt} >= ${previous.from.toISOString()}::timestamptz and ${firstCompleted.firstAt} < ${previous.to.toISOString()}::timestamptz)`.mapWith(Number),
        })
        .from(referrals)
        .innerJoin(firstCompleted, eq(firstCompleted.clientId, referrals.referralId))
        .where(mine),
      ctx.db
        .select({
          accrued: sql<string | null>`sum(${bonusTransactions.amount}) filter (where ${bonusTransactions.kind} = 'accrual' and ${within(bonusTransactions.createdAt, current)})`,
          accruals: sql`count(*) filter (where ${bonusTransactions.kind} = 'accrual' and ${within(bonusTransactions.createdAt, current)})`.mapWith(Number),
          paid: sql<string | null>`sum(${bonusTransactions.amount}) filter (where ${bonusTransactions.kind} = 'withdrawal' and ${within(bonusTransactions.createdAt, current)})`,
          previousAccrued: sql<string | null>`sum(${bonusTransactions.amount}) filter (where ${bonusTransactions.kind} = 'accrual' and ${within(bonusTransactions.createdAt, previous)})`,
          previousAccruals: sql`count(*) filter (where ${bonusTransactions.kind} = 'accrual' and ${within(bonusTransactions.createdAt, previous)})`.mapWith(Number),
          previousPaid: sql<string | null>`sum(${bonusTransactions.amount}) filter (where ${bonusTransactions.kind} = 'withdrawal' and ${within(bonusTransactions.createdAt, previous)})`,
        })
        .from(bonusTransactions)
        .where(eq(bonusTransactions.clientId, clientId)),
      ctx.db
        .select({ amount: sql<string | null>`sum(${withdrawalRequests.amount})` })
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.clientId, clientId),
            inArray(withdrawalRequests.status, OPEN_WITHDRAWAL_STATUSES),
          ),
        ),
      // Пара «реферер — реферал» в `referrals` одна, и заявка реферала
      // считается один раз, на какой бы линии он ни стоял.
      ctx.db
        .select({
          code: exchangeRequests.fromCode,
          amount: sql<string | null>`sum(${exchangeRequests.fromAmount}) filter (where ${completedWithin(current)})`,
          count: sql`count(*) filter (where ${completedWithin(current)})`.mapWith(Number),
          previousAmount: sql<string | null>`sum(${exchangeRequests.fromAmount}) filter (where ${completedWithin(previous)})`,
          previousCount: sql`count(*) filter (where ${completedWithin(previous)})`.mapWith(Number),
        })
        .from(exchangeRequests)
        .innerJoin(referrals, eq(referrals.referralId, exchangeRequests.clientId))
        .where(and(mine, or(completedWithin(current), completedWithin(previous))))
        .groupBy(exchangeRequests.fromCode),
      ctx.db
        .select({ day: localDayOf(referrals.createdAt, offset), n: count() })
        .from(referrals)
        .where(and(mine, within(referrals.createdAt, window)))
        .groupBy(localDayOf(referrals.createdAt, offset)),
      ctx.db
        .select({
          day: localDayOf(bonusTransactions.createdAt, offset),
          amount: sql<string | null>`sum(${bonusTransactions.amount})`,
        })
        .from(bonusTransactions)
        .where(
          and(
            eq(bonusTransactions.clientId, clientId),
            eq(bonusTransactions.kind, 'accrual'),
            within(bonusTransactions.createdAt, window),
          ),
        )
        .groupBy(localDayOf(bonusTransactions.createdAt, offset)),
      // По коду «пришли» считаются той же датой, что и по линиям, — датой
      // привязки: привязанный промокодом после регистрации пришёл в сеть в
      // день ввода кода, а не в день, когда открыл приложение.
      ctx.db
        .select({
          codeId: clients.referredViaCodeId,
          n: sql`count(*) filter (where ${within(referrals.createdAt, current)})`.mapWith(Number),
        })
        .from(referrals)
        .innerJoin(clients, eq(clients.telegramUserId, referrals.referralId))
        .innerJoin(referralCodes, eq(referralCodes.id, clients.referredViaCodeId))
        .where(and(eq(referrals.referrerId, clientId), eq(referrals.line, 1), eq(referralCodes.clientId, clientId)))
        .groupBy(clients.referredViaCodeId),
      // Принесённое кодом — начисления первой линии за заявки тех, кто
      // по нему пришёл: глубже код уже не при чём.
      ctx.db
        .select({
          codeId: clients.referredViaCodeId,
          amount: sql<string | null>`sum(${bonusTransactions.amount}) filter (where ${within(bonusTransactions.createdAt, current)})`,
        })
        .from(bonusTransactions)
        .innerJoin(exchangeRequests, eq(exchangeRequests.id, bonusTransactions.exchangeRequestId))
        .innerJoin(clients, eq(clients.telegramUserId, exchangeRequests.clientId))
        .where(
          and(
            eq(bonusTransactions.clientId, clientId),
            eq(bonusTransactions.kind, 'accrual'),
            eq(bonusTransactions.line, 1),
          ),
        )
        .groupBy(clients.referredViaCodeId),
      activeReferralCodes(ctx.db, clientId),
    ]);

  const summary = (which: 'current' | 'previous'): ReferralPeriodSummary => {
    const byLine = program.lines.map((line) => {
      const row = joined.find((one) => one.line === line.line);
      return { line: line.line, count: (which === 'current' ? row?.n : row?.previous) ?? 0 };
    });
    const point = points[0];
    const paid = amountOf(which === 'current' ? point?.paid : point?.previousPaid);
    return {
      joined: byLine.reduce((total, one) => total + one.count, 0),
      joinedByLine: byLine,
      activated: (which === 'current' ? activated[0]?.n : activated[0]?.previous) ?? 0,
      accrued: amountOf(which === 'current' ? point?.accrued : point?.previousAccrued),
      accruals: (which === 'current' ? point?.accruals : point?.previousAccruals) ?? 0,
      // Списание хранится отрицательным: выплачено — это минус сумма.
      paid: Money.isNegative(paid) ? Money.subtract(Money.ZERO, paid) : paid,
      turnover: turnover
        .map((row) => ({
          code: row.code,
          amount: amountOf(which === 'current' ? row.amount : row.previousAmount),
          count: which === 'current' ? row.count : row.previousCount,
        }))
        .filter((row) => row.count > 0)
        .sort((a, b) => a.code.localeCompare(b.code)),
    };
  };

  const joinedOn = new Map(joinedByDay.map((row) => [row.day, row.n]));
  const accruedOn = new Map(accruedByDay.map((row) => [row.day, amountOf(row.amount)]));
  // Все дни окна, включая пустые: столбики без провалов.
  const byDay: ReferralCabinetDay[] = [];
  for (let at = window.from.getTime(); at < window.to.getTime(); at += DAY_MS) {
    const day = dayKey(new Date(at), offset);
    byDay.push({ day, joined: joinedOn.get(day) ?? 0, accrued: accruedOn.get(day) ?? Money.ZERO });
  }

  return {
    period: current,
    current: summary('current'),
    previous: summary('previous'),
    pending: amountOf(pending[0]?.amount),
    byDay,
    codes: codes.map((code) => ({
      id: code.id,
      code: code.code,
      kind: code.kind,
      label: code.label,
      joined: codeJoins.find((row) => row.codeId === code.id)?.n ?? 0,
      accrued: amountOf(codeAccruals.find((row) => row.codeId === code.id)?.amount),
    })),
  };
}

/** Реферал глазами реферера — без имени, ника и идентификатора. */
export interface MyReferralView {
  readonly joinedAt: Date;
  readonly line: ReferralLine;
  /** По какому коду пришёл — только у первой линии: дальше код чужой. */
  readonly via: { readonly label: string; readonly kind: ReferralCodeKind } | null;
  /** Есть хотя бы одна исполненная заявка. */
  readonly active: boolean;
  readonly completedCount: number;
  /** Сколько принёс баллов — начисления рефереру за его заявки. */
  readonly brought: Amount;
  readonly lastExchangeAt: Date | null;
}

export interface MyReferralsPage {
  readonly items: readonly MyReferralView[];
  readonly total: number;
  /** Смещение следующей страницы; пусто — это последняя. */
  readonly nextOffset: number | null;
}

export interface ListMyReferralsInput {
  readonly line?: number | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

const REFERRALS_PAGE = 50;

/**
 * Список листается смещением, а не курсором по паре «дата и
 * идентификатор»: курсор нёс бы идентификатор реферала, которого
 * клиент видеть не должен, а список редко длиннее сотни строк.
 */
export async function listMyReferrals(
  ctx: CoreConfig,
  actor: Actor,
  input: ListMyReferralsInput = {},
): Promise<MyReferralsPage> {
  const clientId = requireClient(actor);
  const program = await readReferralProgram(ctx.db);
  const offset = requireWhole(input.offset, 0, 'Смещение');
  const limit = Math.min(Math.max(1, requireWhole(input.limit, REFERRALS_PAGE, 'Предел')), REFERRALS_PAGE);
  if (input.line !== undefined && !isReferralLine(input.line)) {
    throw new InvalidInputError('Линия от 1 до 5');
  }
  const mine = and(
    eq(referrals.referrerId, clientId),
    lte(referrals.line, program.depth),
    ...(input.line === undefined ? [] : [eq(referrals.line, input.line)]),
  )!;

  const [rows, total] = await Promise.all([
    ctx.db
      .select({
        joinedAt: referrals.createdAt,
        line: referrals.line,
        viaLabel: referralCodes.label,
        viaKind: referralCodes.kind,
        completedCount: sql`(select count(*) from ${exchangeRequests} where ${exchangeRequests.clientId} = ${referrals.referralId} and ${exchangeRequests.status} = 'completed')`.mapWith(Number),
        lastExchangeAt: sql<string | null>`(select max(${exchangeRequests.completedAt}) from ${exchangeRequests} where ${exchangeRequests.clientId} = ${referrals.referralId} and ${exchangeRequests.status} = 'completed')`,
        brought: sql<string | null>`(select sum(${bonusTransactions.amount}) from ${bonusTransactions} where ${bonusTransactions.clientId} = ${referrals.referrerId} and ${bonusTransactions.kind} = 'accrual' and ${bonusTransactions.exchangeRequestId} in (select ${exchangeRequests.id} from ${exchangeRequests} where ${exchangeRequests.clientId} = ${referrals.referralId}))`,
      })
      .from(referrals)
      .innerJoin(clients, eq(clients.telegramUserId, referrals.referralId))
      // Только свой код: у первой линии он и так свой, но условие в
      // соединении держит это правило, а не инвариант данных.
      .leftJoin(
        referralCodes,
        and(eq(referralCodes.id, clients.referredViaCodeId), eq(referralCodes.clientId, clientId)),
      )
      .where(mine)
      .orderBy(desc(referrals.createdAt), asc(referrals.referralId))
      .limit(limit + 1)
      .offset(offset),
    ctx.db.select({ n: count() }).from(referrals).where(mine),
  ]);

  const items = rows.slice(0, limit).map((row): MyReferralView => {
    // Схема держит линию в 1..5; иное — не данные, а поломка.
    if (!isReferralLine(row.line)) {
      throw new Error(`Линия вне схемы: ${row.line}`);
    }
    return {
    joinedAt: row.joinedAt,
    line: row.line,
    via: row.line === 1 && row.viaLabel && row.viaKind ? { label: row.viaLabel, kind: row.viaKind } : null,
    active: row.completedCount > 0,
    completedCount: row.completedCount,
    brought: amountOf(row.brought),
    lastExchangeAt: row.lastExchangeAt ? new Date(row.lastExchangeAt) : null,
    };
  });

  return {
    items,
    total: total[0]?.n ?? 0,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}
