import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { currencies, feeScheduleTiers, feeSchedules } from '@nemo/db';
import {
  feeScheduleSchema,
  Money,
  payoutMethodSchema,
  type FeeTier,
  type PayoutMethod,
} from '@nemo/types';
import { requireAdmin, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import { recordSettingsChange } from './settings-audit.js';

/**
 * Сетка комиссии для валюты и способа выдачи — или её отсутствие.
 *
 * Пусто означает «этому направлению цену назначает наценка сервиса», а
 * не «обмен невозможен»: сетки владелец присылает по одной, письмом на
 * направление, и до письма всё считается по-старому. Два правила цены
 * разом — решение, а не переходное состояние: у обмена USDT на рубли
 * своя экономика, и ступени бата туда не переносятся.
 *
 * Погашенная сетка тоже читается пустой: администратор гасит её, когда
 * цена по ней стала убыточной, и направление возвращается к наценке —
 * не закрывается вовсе.
 */
export async function readFeeSchedule(
  executor: Executor,
  toCode: string,
  payoutMethod: PayoutMethod,
): Promise<readonly FeeTier[] | null> {
  const rows = await executor
    .select({
      upToUsd: feeScheduleTiers.upToUsd,
      fixedUsd: feeScheduleTiers.fixedUsd,
      rateBps: feeScheduleTiers.rateBps,
    })
    .from(feeScheduleTiers)
    .innerJoin(feeSchedules, eq(feeScheduleTiers.scheduleId, feeSchedules.id))
    .where(
      and(
        eq(feeSchedules.toCode, toCode),
        eq(feeSchedules.payoutMethod, payoutMethod),
        eq(feeSchedules.isActive, true),
      ),
    )
    // Ступени по возрастанию порога, последняя — та, что без границы.
    // Порядок задаёт цену: считающий берёт первую подходящую, и строка
    // «и всё, что выше», оказавшаяся первой, сделала бы ставку одной на
    // все суммы.
    .orderBy(sql`${feeScheduleTiers.upToUsd} asc nulls last`, asc(feeScheduleTiers.id));

  if (rows.length === 0) return null;

  return rows.map(toTier);
}

function toTier(row: {
  upToUsd: string | null;
  fixedUsd: string | null;
  rateBps: number | null;
}): FeeTier {
  return {
    upToUsd: row.upToUsd === null ? null : Money.toAmount(row.upToUsd),
    ...(row.fixedUsd === null ? {} : { fixedUsd: Money.toAmount(row.fixedUsd) }),
    ...(row.rateBps === null ? {} : { rateBps: row.rateBps }),
  };
}

/**
 * Сетка целиком — администратору, который ею управляет.
 *
 * Ставки задаёт он из панели, а не выкатка: комиссия — решение о
 * деньгах, и просить разработчика на каждую правку процента значило бы
 * держать цену обмена в расписании релизов.
 */
export interface FeeScheduleView {
  readonly id: string;
  readonly toCode: string;
  readonly payoutMethod: PayoutMethod;
  readonly isActive: boolean;
  readonly tiers: readonly FeeTier[];
  readonly updatedAt: Date;
}

/** Ступени приходят с экрана строками — числом их не удержать. */
export interface SaveFeeScheduleInput {
  readonly toCode: string;
  readonly payoutMethod: PayoutMethod;
  readonly tiers: readonly {
    readonly upToUsd: string | null;
    readonly fixedUsd?: string | undefined;
    readonly rateBps?: number | undefined;
  }[];
}

/** Весь список, включая погашенные: администратор их включает обратно. */
export async function listFeeSchedules(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly FeeScheduleView[]> {
  requireAdmin(actor);
  return readSchedules(ctx.db);
}

async function readSchedules(
  executor: Executor,
  onlyId?: string,
): Promise<readonly FeeScheduleView[]> {
  const schedules = await executor
    .select()
    .from(feeSchedules)
    .where(onlyId === undefined ? undefined : eq(feeSchedules.id, onlyId))
    .orderBy(asc(feeSchedules.toCode), asc(feeSchedules.payoutMethod));

  if (schedules.length === 0) return [];

  const tiers = await executor
    .select()
    .from(feeScheduleTiers)
    .where(
      inArray(
        feeScheduleTiers.scheduleId,
        schedules.map((one) => one.id),
      ),
    )
    // Тот же порядок, что и у читающего котировку: ступень выбирается
    // первой подходящей, и порядок здесь — часть цены, а не оформление.
    .orderBy(sql`${feeScheduleTiers.upToUsd} asc nulls last`, asc(feeScheduleTiers.id));

  return schedules.map((schedule) => ({
    id: schedule.id,
    toCode: schedule.toCode,
    payoutMethod: schedule.payoutMethod,
    isActive: schedule.isActive,
    updatedAt: schedule.updatedAt,
    tiers: tiers.filter((tier) => tier.scheduleId === schedule.id).map(toTier),
  }));
}

/**
 * Проверка сетки целиком — той же схемой, которой её проверяет экран
 * клиента.
 *
 * Своей копии правил здесь нет намеренно: по этой сетке считает и ядро,
 * и калькулятор в Mini App, и разойдись они — клиент увидел бы сумму,
 * которой не будет.
 */
function requireValidTiers(input: SaveFeeScheduleInput['tiers']): readonly FeeTier[] {
  if (input.length === 0) {
    throw new InvalidInputError('В сетке нет ни одной ступени: цена по ней не считается');
  }

  const parsed = feeScheduleSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  /*
   * Доменные правила объяснены по-русски в самой схеме, а служебные
   * замечания zod — по-английски. Показывать администратору
   * «Invalid input» незачем: он правит проценты, а не разбирает разбор.
   */
  const first = parsed.error.issues[0]?.message;
  throw new InvalidInputError(
    first !== undefined && /[а-яё]/i.test(first) ? first : 'Ступени сетки заданы неверно',
  );
}

/**
 * Завести сетку или переписать её ступени.
 *
 * Валюта и способ выдачи — ключ, а не поля: сетка «бат на кошелёк» и
 * «бат на банк» это две разные цены, и правка одной в другую означала
 * бы, что администратор молча перенёс ставки не туда. Меняются только
 * ступени, и меняются целиком — дописывание строк к прежним оставляло
 * бы в сетке пороги, которых администратор на экране уже не видит.
 */
export async function saveFeeSchedule(
  ctx: CoreConfig,
  actor: Actor,
  input: SaveFeeScheduleInput,
): Promise<FeeScheduleView> {
  const admin = requireAdmin(actor);

  const method = payoutMethodSchema.safeParse(input.payoutMethod);
  if (!method.success) {
    throw new InvalidInputError('Неизвестный способ выдачи');
  }
  const payoutMethod = method.data;

  const toCode = input.toCode.trim().toUpperCase();
  const tiers = requireValidTiers(input.tiers);

  return ctx.db.transaction(async (tx) => {
    const [currency] = await tx
      .select({ code: currencies.code })
      .from(currencies)
      .where(eq(currencies.code, toCode))
      .limit(1);
    if (!currency) {
      throw new NotFoundError(`Валюты ${toCode} нет в справочнике`);
    }

    const [existing] = await readSchedulesByTarget(tx, toCode, payoutMethod);

    /*
     * Новая сетка заводится погашенной, и это важнее удобства: строка
     * появляется со ступенями, которые администратор ещё не правил, —
     * а действующая сетка сразу меняет цену живым клиентам. Включает её
     * он сам, разобравшись с числами. Правка существующей состояния не
     * трогает: выключенную правят выключенной, действующую — на ходу.
     */
    const [row] = await tx
      .insert(feeSchedules)
      .values({ toCode, payoutMethod, isActive: false })
      .onConflictDoUpdate({
        target: [feeSchedules.toCode, feeSchedules.payoutMethod],
        set: { updatedAt: new Date() },
      })
      .returning({ id: feeSchedules.id });

    const scheduleId = row!.id;
    await tx.delete(feeScheduleTiers).where(eq(feeScheduleTiers.scheduleId, scheduleId));
    await tx.insert(feeScheduleTiers).values(
      tiers.map((tier) => ({
        scheduleId,
        upToUsd: tier.upToUsd,
        ...(tier.fixedUsd === undefined ? {} : { fixedUsd: tier.fixedUsd }),
        ...(tier.rateBps === undefined ? {} : { rateBps: tier.rateBps }),
      })),
    );

    const [saved] = await readSchedules(tx, scheduleId);
    await recordSettingsChange(tx, admin.staffId, 'fee_schedule', scheduleId, {
      before: existing ?? null,
      after: saved,
    });
    return saved!;
  });
}

async function readSchedulesByTarget(
  executor: Executor,
  toCode: string,
  payoutMethod: PayoutMethod,
): Promise<readonly FeeScheduleView[]> {
  const [row] = await executor
    .select({ id: feeSchedules.id })
    .from(feeSchedules)
    .where(and(eq(feeSchedules.toCode, toCode), eq(feeSchedules.payoutMethod, payoutMethod)))
    .limit(1);
  return row === undefined ? [] : readSchedules(executor, row.id);
}

/**
 * Гашение и возврат сетки.
 *
 * Погашенная не удаляется: направление возвращается к наценке — той
 * цене, по которой оно считалось до первой присланной владельцем
 * таблицы, — и включить сетку обратно можно тем же нажатием. Удаление
 * стоило бы набора четырёх ступеней заново.
 */
export async function setFeeScheduleActive(
  ctx: CoreConfig,
  actor: Actor,
  scheduleId: string,
  isActive: boolean,
): Promise<FeeScheduleView> {
  const admin = requireAdmin(actor);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(feeSchedules)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(feeSchedules.id, scheduleId))
      .returning({ id: feeSchedules.id });
    if (!row) {
      throw new NotFoundError('Сетка комиссии не найдена');
    }

    const [saved] = await readSchedules(tx, row.id);
    await recordSettingsChange(tx, admin.staffId, 'fee_schedule', row.id, {
      isActive,
      toCode: saved!.toCode,
      payoutMethod: saved!.payoutMethod,
    });
    return saved!;
  });
}
