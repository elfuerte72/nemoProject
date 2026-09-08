import { and, asc, eq, sql } from 'drizzle-orm';
import {
  clientReferralRates,
  clients,
  exchangeRequests,
  referralLineRates,
  referralTierRates,
  referralTiers,
  referrals,
} from '@nemo/db';
import { MAX_REFERRAL_DEPTH, isReferralLine, type ReferralLine } from '@nemo/types';
import { requireAdmin, requireStaff, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import { requireBps } from './settings.js';
import { recordSettingsChange } from './settings-audit.js';

/**
 * Настраиваемая реферальная программа (docs/adr/0019).
 *
 * Глубина — сколько линий сервис оплачивает — задаётся строками базовых
 * ставок: сколько строк, столько линий. Цепочка предков при этом
 * хранится глубже (`MAX_REFERRAL_DEPTH`), и углубление программы
 * доходит до старых цепочек.
 *
 * У ставки линии три источника по старшинству: личная ставка клиента,
 * ставка его уровня, базовая. Считается это в одном месте —
 * `effectiveReferralRates` — и для начисления, и для показа клиенту:
 * ставка на экране и ставка в начислении не должны разойтись.
 */

export interface ReferralLineRate {
  readonly line: ReferralLine;
  /** В базисных пунктах: 100 bps = 1%. */
  readonly rateBps: number;
}

export interface ReferralTierView {
  readonly id: string;
  readonly name: string;
  /** С какого числа активных рефералов первой линии уровень действует. */
  readonly minActiveReferrals: number;
  /** Ставки уровня; линия без строки наследует базовую. */
  readonly rates: readonly ReferralLineRate[];
  readonly createdAt: Date;
}

export interface ReferralProgramView {
  /** Сколько линий оплачивается. */
  readonly depth: number;
  readonly lines: readonly ReferralLineRate[];
  /** По возрастанию порога. */
  readonly tiers: readonly ReferralTierView[];
}

export type ReferralRateSource = 'individual' | 'tier' | 'base';

export interface EffectiveLineRate {
  readonly line: ReferralLine;
  readonly rateBps: number;
  readonly source: ReferralRateSource;
  /** Название уровня, если ставка взята из него. */
  readonly tierName: string | null;
}

/** Где клиент стоит среди уровней. `null` — уровней не заведено. */
export interface TierStanding {
  readonly current: ReferralTierView | null;
  readonly next: ReferralTierView | null;
  /** Рефералов первой линии с хотя бы одной исполненной заявкой. */
  readonly activeReferrals: number;
  /** Сколько активных не хватает до следующего уровня; 0 — выше некуда. */
  readonly toNext: number;
}

export interface EffectiveReferralRates {
  readonly lines: readonly EffectiveLineRate[];
  readonly tier: TierStanding | null;
}

/** Ставка линии из формы или запроса: линия числом, ставка в базисных пунктах. */
export interface ReferralRateInput {
  readonly line: number;
  readonly rateBps: number;
}

function toLine(value: number, subject: string): ReferralLine {
  if (!isReferralLine(value)) {
    throw new InvalidInputError(`${subject}: линия от 1 до ${MAX_REFERRAL_DEPTH}`);
  }
  return value;
}

/** Список ставок по линиям: линии законные, ставки в пределах, по одной на линию. */
function parseRates(input: readonly ReferralRateInput[], subject: string): ReferralLineRate[] {
  const rates = input.map((one) => {
    const line = toLine(one.line, subject);
    return { line, rateBps: requireBps(one.rateBps, `${subject} ${line}-й линии`) };
  });
  if (new Set(rates.map((one) => one.line)).size !== rates.length) {
    throw new InvalidInputError(`${subject}: у линии одно значение`);
  }
  return rates;
}

export async function readReferralProgram(executor: Executor): Promise<ReferralProgramView> {
  // Последовательно, а не `Promise.all`: читается и внутри транзакции
  // начисления, где соединение одно.
  const lineRows = await executor
    .select()
    .from(referralLineRates)
    .orderBy(asc(referralLineRates.line));
  const tierRows = await executor
    .select()
    .from(referralTiers)
    .orderBy(asc(referralTiers.minActiveReferrals));
  const rateRows = await executor
    .select()
    .from(referralTierRates)
    .orderBy(asc(referralTierRates.line));

  const lines = lineRows
    .filter((row) => isReferralLine(row.line))
    .map((row) => ({ line: row.line as ReferralLine, rateBps: row.rateBps }));
  const tiers = tierRows.map((tier) => ({
    id: tier.id,
    name: tier.name,
    minActiveReferrals: tier.minActiveReferrals,
    rates: rateRows
      .filter((rate) => rate.tierId === tier.id && isReferralLine(rate.line))
      .map((rate) => ({ line: rate.line as ReferralLine, rateBps: rate.rateBps })),
    createdAt: tier.createdAt,
  }));

  return { depth: lines.length, lines, tiers };
}

/**
 * Активные рефералы первой линии: приведённые самим клиентом, у
 * которых есть исполненная заявка. Реферал с десятью заявками — один;
 * реферал без заявок — ноль: уровень зарабатывается сделками сети, а не
 * её размером.
 */
export async function countActiveReferrals(executor: Executor, referrerId: bigint): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(distinct ${referrals.referralId})::int` })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerId, referrerId),
        eq(referrals.line, 1),
        sql`exists (select 1 from ${exchangeRequests} where ${exchangeRequests.clientId} = ${referrals.referralId} and ${exchangeRequests.status} = 'completed')`,
      ),
    );
  return row?.n ?? 0;
}

function standing(tiers: readonly ReferralTierView[], activeReferrals: number): TierStanding | null {
  if (tiers.length === 0) return null;
  const reached = tiers.filter((tier) => tier.minActiveReferrals <= activeReferrals);
  const current = reached[reached.length - 1] ?? null;
  const next = tiers.find((tier) => tier.minActiveReferrals > activeReferrals) ?? null;
  return {
    current,
    next,
    activeReferrals,
    toNext: next ? next.minActiveReferrals - activeReferrals : 0,
  };
}

export async function effectiveReferralRates(
  executor: Executor,
  referrerId: bigint,
  program?: ReferralProgramView,
): Promise<EffectiveReferralRates> {
  const known = program ?? (await readReferralProgram(executor));
  const individual = await executor
    .select()
    .from(clientReferralRates)
    .where(eq(clientReferralRates.clientId, referrerId));
  const active = await countActiveReferrals(executor, referrerId);
  const tier = standing(known.tiers, active);

  const lines = known.lines.map((base): EffectiveLineRate => {
    const own = individual.find((one) => one.line === base.line);
    if (own) {
      return { line: base.line, rateBps: own.rateBps, source: 'individual', tierName: null };
    }
    const fromTier = tier?.current?.rates.find((one) => one.line === base.line);
    if (fromTier && tier?.current) {
      return {
        line: base.line,
        rateBps: fromTier.rateBps,
        source: 'tier',
        tierName: tier.current.name,
      };
    }
    return { line: base.line, rateBps: base.rateBps, source: 'base', tierName: null };
  });

  return { lines, tier };
}

/** Программа — сотруднику: ставки публичны, менеджеру они нужны в карточке. */
export async function getReferralProgram(ctx: CoreConfig, actor: Actor): Promise<ReferralProgramView> {
  requireStaff(actor);
  return readReferralProgram(ctx.db);
}

/**
 * Глубина и базовые ставки — списком линий подряд от первой: «третья
 * линия без второй» не имеет смысла, и пропуск в списке — опечатка, а
 * не настройка.
 */
export async function updateReferralLines(
  ctx: CoreConfig,
  actor: Actor,
  input: readonly ReferralRateInput[],
): Promise<ReferralProgramView> {
  const admin = requireAdmin(actor);
  if (input.length === 0 || input.length > MAX_REFERRAL_DEPTH) {
    throw new InvalidInputError(`Линий от 1 до ${MAX_REFERRAL_DEPTH}`);
  }
  const lines = parseRates(input, 'Ставка').sort((a, b) => a.line - b.line);
  lines.forEach((one, index) => {
    if (one.line !== index + 1) {
      throw new InvalidInputError('Линии идут подряд от первой, без пропусков');
    }
  });

  return ctx.db.transaction(async (tx) => {
    const before = (await readReferralProgram(tx)).lines;
    await tx.delete(referralLineRates);
    await tx.insert(referralLineRates).values(lines);
    const after = await readReferralProgram(tx);
    await recordSettingsChange(tx, admin.staffId, 'referral_line_rates', null, {
      before,
      after: after.lines,
    });
    return after;
  });
}

export interface UpsertReferralTierInput {
  readonly id?: string | undefined;
  readonly name: string;
  readonly minActiveReferrals: number;
  readonly rates: readonly ReferralRateInput[];
}

export async function upsertReferralTier(
  ctx: CoreConfig,
  actor: Actor,
  input: UpsertReferralTierInput,
): Promise<ReferralTierView> {
  const admin = requireAdmin(actor);
  const name = input.name.trim();
  if (name.length === 0 || name.length > 40) {
    throw new InvalidInputError('Название уровня — от 1 до 40 знаков');
  }
  if (!Number.isInteger(input.minActiveReferrals) || input.minActiveReferrals < 1) {
    throw new InvalidInputError('Порог уровня — целое число активных рефералов, от одного');
  }
  const rates = parseRates(input.rates, 'Ставка уровня');

  return ctx.db.transaction(async (tx) => {
    const before = input.id ? (await readReferralProgram(tx)).tiers.find((one) => one.id === input.id) : undefined;
    if (input.id && !before) {
      throw new NotFoundError('Уровень не найден');
    }
    const [taken] = await tx
      .select({ id: referralTiers.id })
      .from(referralTiers)
      .where(eq(referralTiers.minActiveReferrals, input.minActiveReferrals))
      .limit(1);
    if (taken && taken.id !== input.id) {
      throw new InvalidInputError('Уровень с таким порогом уже есть');
    }

    let id = input.id;
    if (id) {
      await tx
        .update(referralTiers)
        .set({ name, minActiveReferrals: input.minActiveReferrals })
        .where(eq(referralTiers.id, id));
      await tx.delete(referralTierRates).where(eq(referralTierRates.tierId, id));
    } else {
      const [inserted] = await tx
        .insert(referralTiers)
        .values({ name, minActiveReferrals: input.minActiveReferrals })
        .returning({ id: referralTiers.id });
      id = inserted!.id;
    }
    if (rates.length > 0) {
      await tx.insert(referralTierRates).values(rates.map((one) => ({ tierId: id, ...one })));
    }

    const after = (await readReferralProgram(tx)).tiers.find((one) => one.id === id);
    await recordSettingsChange(tx, admin.staffId, 'referral_tier', id, {
      before: before ?? null,
      after: after ?? null,
    });
    return after!;
  });
}

export async function deleteReferralTier(ctx: CoreConfig, actor: Actor, id: string): Promise<void> {
  const admin = requireAdmin(actor);
  await ctx.db.transaction(async (tx) => {
    const before = (await readReferralProgram(tx)).tiers.find((one) => one.id === id);
    if (!before) {
      throw new NotFoundError('Уровень не найден');
    }
    await tx.delete(referralTiers).where(eq(referralTiers.id, id));
    await recordSettingsChange(tx, admin.staffId, 'referral_tier', id, { before, after: null });
  });
}

/**
 * Личные ставки клиента: список по линиям или `null` — снять все.
 * Линия без строки остаётся на уровне или базовой.
 */
export async function setClientReferralRates(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
  input: readonly ReferralRateInput[] | null,
): Promise<readonly ReferralLineRate[]> {
  const admin = requireAdmin(actor);
  const rates = parseRates(input ?? [], 'Личная ставка');

  return ctx.db.transaction(async (tx) => {
    const [client] = await tx
      .select({ id: clients.telegramUserId })
      .from(clients)
      .where(eq(clients.telegramUserId, clientId))
      .limit(1);
    if (!client) {
      throw new NotFoundError('Клиент не найден');
    }
    const before = await tx
      .select({ line: clientReferralRates.line, rateBps: clientReferralRates.rateBps })
      .from(clientReferralRates)
      .where(eq(clientReferralRates.clientId, clientId))
      .orderBy(asc(clientReferralRates.line));
    await tx.delete(clientReferralRates).where(eq(clientReferralRates.clientId, clientId));
    if (rates.length > 0) {
      await tx.insert(clientReferralRates).values(rates.map((one) => ({ clientId, ...one })));
    }
    await recordSettingsChange(tx, admin.staffId, 'client_referral_rates', String(clientId), {
      before,
      after: rates,
    });
    return rates;
  });
}
