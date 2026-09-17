import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { bonusTransactions, referrals, withdrawalRequests } from '@nemo/db';
import {
  Money,
  isReferralLine,
  isWithdrawalOpen,
  withdrawalRequestStatuses,
  type Amount,
  type BonusTransactionKind,
  type ReferralLine,
} from '@nemo/types';
import { requireClient, type Actor } from './actor.js';
import { CLIENT_HISTORY_LIMIT } from './client-history.js';
import { promoBindingObstacle } from './clients.js';
import type { CoreConfig, Executor } from './context.js';
import { activeReferralCodes, primaryReferralCode, type ReferralCodeView } from './referral-codes.js';
import {
  effectiveReferralRates,
  readReferralProgram,
  type ReferralRateSource,
  type TierStanding,
} from './referral-program.js';
import { readServiceSettings } from './settings.js';

/**
 * Реферальный кабинет клиента: сколько заработал, скольких привёл и за
 * что именно начислено.
 *
 * Баланс — сумма движений, а не отдельно хранимое число. Остаток,
 * который можно рассинхронизировать с историей, рано или поздно с ней
 * расходится, и тогда непонятно, какому из двух чисел верить.
 *
 * Про самих рефералов клиент видит только количество. Ни имени, ни
 * username, ни идентификатора: реферальная программа не повод раскрывать
 * одному клиенту, кто такой другой.
 */

export interface BonusTransactionView {
  readonly id: string;
  readonly kind: BonusTransactionKind;
  readonly amount: Amount;
  /** Линия, по которой начислено. У списаний и правок её нет. */
  readonly line: ReferralLine | null;
  /** Ставка линии на момент начисления, в базисных пунктах. */
  readonly rateBps: number | null;
  /** Заявка на обмен, за которую начислено. */
  readonly exchangeRequestId: string | null;
  readonly comment: string | null;
  readonly createdAt: Date;
}

/** Линия глазами реферера: скольких привёл и по какой ставке платят. */
export interface BonusLineView {
  readonly line: ReferralLine;
  readonly count: number;
  /**
   * Ставка в базисных пунктах — та же, по которой начислит ядро: считана
   * тем же `effectiveReferralRates`, что и начисление. Отдаётся текущая,
   * а не та, по которой начислено: ставка каждого начисления сохранена
   * в самом движении, и прошлое от смены настроек не меняется.
   */
  readonly rateBps: number;
  /** Откуда ставка: личная, уровень, базовая. */
  readonly source: ReferralRateSource;
  readonly tierName: string | null;
}

export interface BonusAccountView {
  readonly balance: Amount;
  /**
   * Сколько из остатка можно забрать сейчас: он же за вычетом уже
   * поданных заявок. Считается тем же счётом, каким проверяет подача, —
   * иначе экран предлагал бы подать заявку на баллы, обещанные другой,
   * и отказ приходил бы после нажатия.
   */
  readonly available: Amount;
  /**
   * Сколько начислено за всё время. Баланс — это остаток, и выведший
   * половину заработанного видит в нём половину; на вопрос «сколько мне
   * принесла рефералка» отвечает только это число.
   *
   * Считаются одни начисления: ручная правка администратора меняет
   * баланс, но заработком реферальной программы не является.
   */
  readonly earned: Amount;
  /** Основной код — самая ранняя действующая ссылка. Саму ссылку собирает приложение. */
  readonly referralCode: string;
  /**
   * Линии по настроенной глубине: скольких привёл и по какой ставке
   * платят. Клиенту ставки называют: реферальная программа, условий
   * которой не видно, не работает — звать знакомых, не зная, сколько за
   * это платят, никто не станет. Приложение переводит их в проценты.
   */
  readonly lines: readonly BonusLineView[];
  /** Уровень: текущий, следующий, активных рефералов. Пусто — уровней нет. */
  readonly tier: TierStanding | null;
  /** Действующие коды: ссылки и промокоды, в порядке заведения. */
  readonly codes: readonly ReferralCodeView[];
  /**
   * Можно ли ввести чужой промокод: реферера ещё нет и заявок не было
   * (docs/adr/0021). Экран показывает поле по этому признаку, а
   * решает всё равно операция.
   */
  readonly canEnterPromo: boolean;
  /**
   * Минимальная сумма вывода — та же, по которой отказывает операция.
   *
   * Клиенту её называют до подачи: заявка, отвергнутая по порогу, о
   * котором нигде не сказано, читается как поломка. Отдаётся вместе со
   * счётом, потому что смысл имеет только рядом с балансом — вывести
   * можно то, что есть, и не меньше этого.
   */
  readonly minWithdrawalAmount: Amount;
  readonly history: readonly BonusTransactionView[];
}

type BonusTransactionRow = typeof bonusTransactions.$inferSelect;

export function toBonusTransactionView(row: BonusTransactionRow): BonusTransactionView {
  return {
    id: row.id,
    kind: row.kind,
    amount: Money.toAmount(row.amount),
    line: row.line !== null && isReferralLine(row.line) ? row.line : null,
    rateBps: row.rateBps,
    exchangeRequestId: row.exchangeRequestId,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

/**
 * Бонусный баланс клиента.
 *
 * Считается запросом к базе, а не сложением выгруженных строк: история
 * растёт, а баланс нужен и там, где вся она ни к чему — например перед
 * заявкой на вывод.
 */
export async function bonusBalance(
  executor: Executor,
  clientId: bigint,
): Promise<Amount> {
  const [row] = await executor
    .select({ total: sql<string | null>`sum(${bonusTransactions.amount})` })
    .from(bonusTransactions)
    .where(eq(bonusTransactions.clientId, clientId));

  // Пусто у клиента без движений: ни одного начисления ещё не было.
  return row?.total === null || row?.total === undefined
    ? Money.ZERO
    : Money.toAmount(row.total);
}

/**
 * Сколько клиенту начислено за всё время.
 *
 * Считается запросом, а не сложением выгруженной истории: история
 * ограничена потолком, и сумма по её видимому куску занижала бы
 * заработанное ровно у тех, кто заработал больше всех.
 */
async function bonusEarned(executor: Executor, clientId: bigint): Promise<Amount> {
  const [row] = await executor
    .select({ total: sql<string | null>`sum(${bonusTransactions.amount})` })
    .from(bonusTransactions)
    .where(
      and(eq(bonusTransactions.clientId, clientId), eq(bonusTransactions.kind, 'accrual')),
    );

  return row?.total === null || row?.total === undefined ? Money.ZERO : Money.toAmount(row.total);
}

/** Состояния, в которых заявка ещё держит баллы: одно правило на ядро. */
const OPEN_WITHDRAWAL_STATUSES = withdrawalRequestStatuses.filter(isWithdrawalOpen);

/**
 * Сколько баллов держат поданные заявки на вывод.
 *
 * Запросом, а не сложением списка заявок: список у клиента ограничен
 * потолком истории, и открытая заявка старше этого потолка выпала бы
 * из счёта — экран показал бы больше, чем разрешит подача, а отказ
 * пришёл бы уже после нажатия.
 */
async function heldByWithdrawals(executor: Executor, clientId: bigint): Promise<Amount> {
  const [row] = await executor
    .select({ total: sql<string | null>`sum(${withdrawalRequests.amount})` })
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.clientId, clientId),
        inArray(withdrawalRequests.status, OPEN_WITHDRAWAL_STATUSES),
      ),
    );

  return row?.total == null ? Money.ZERO : Money.toAmount(row.total);
}

export interface BonusStanding {
  /** Сумма движений. */
  readonly balance: Amount;
  /** Сколько из неё держат поданные заявки на вывод. */
  readonly held: Amount;
  /** Остаток за вычетом занятого: столько можно вывести или снять. */
  readonly available: Amount;
}

/**
 * Остаток и доступное — одним счётом на всё ядро.
 *
 * Баллы списываются при выплате, а не при подаче, поэтому между ними
 * сумма заявки остаётся на счёте, но уже обещана клиенту. Читают это
 * число кабинет, подача заявки на вывод и правка баллов руками: разойдись
 * они, экран предлагал бы вывести обещанное другой заявке, а снятие
 * администратора забирало бы баллы, за которые менеджер потом заплатит
 * деньгами (разбор 17 сентября 2026).
 */
export async function bonusStanding(
  executor: Executor,
  clientId: bigint,
): Promise<BonusStanding> {
  const [balance, held] = await Promise.all([
    bonusBalance(executor, clientId),
    heldByWithdrawals(executor, clientId),
  ]);
  return { balance, held, available: Money.subtract(balance, held) };
}

async function countReferralsByLine(
  executor: Executor,
  clientId: bigint,
): Promise<ReadonlyMap<number, number>> {
  const rows = await executor
    .select({ line: referrals.line, value: count() })
    .from(referrals)
    .where(eq(referrals.referrerId, clientId))
    .groupBy(referrals.line);
  return new Map(rows.map((row) => [row.line, row.value]));
}

/**
 * Движения по баллам сами по себе — без остатка, сети и ссылки.
 *
 * Кабинету они нужны вместе со всем этим, ленте истории — отдельно и
 * рядом с заявками. Запрос один и тот же, и повторять его на месте
 * значило бы завести вторую правду о том, в каком порядке читается
 * история баллов.
 */
export async function listBonusTransactions(
  executor: Executor,
  clientId: bigint,
): Promise<readonly BonusTransactionView[]> {
  const rows = await executor
    .select()
    .from(bonusTransactions)
    .where(eq(bonusTransactions.clientId, clientId))
    .orderBy(desc(bonusTransactions.createdAt), desc(bonusTransactions.id))
    .limit(CLIENT_HISTORY_LIMIT);
  return rows.map(toBonusTransactionView);
}

export async function getBonusAccount(
  ctx: CoreConfig,
  actor: Actor,
): Promise<BonusAccountView> {
  const clientId = requireClient(actor);

  const program = await readReferralProgram(ctx.db);
  const [standing, earned, counts, history, settings, rates, referralCode, codes, promo] =
    await Promise.all([
      bonusStanding(ctx.db, clientId),
      bonusEarned(ctx.db, clientId),
      countReferralsByLine(ctx.db, clientId),
      listBonusTransactions(ctx.db, clientId),
      readServiceSettings(ctx.db),
      effectiveReferralRates(ctx.db, clientId, program),
      primaryReferralCode(ctx.db, clientId),
      activeReferralCodes(ctx.db, clientId),
      promoBindingObstacle(ctx.db, clientId),
    ]);

  return {
    balance: standing.balance,
    available: standing.available,
    earned,
    referralCode,
    codes,
    canEnterPromo: promo === null,
    lines: rates.lines.map((rate) => ({
      line: rate.line,
      count: counts.get(rate.line) ?? 0,
      rateBps: rate.rateBps,
      source: rate.source,
      tierName: rate.tierName,
    })),
    tier: rates.tier,
    minWithdrawalAmount: settings.minWithdrawalAmount,
    history,
  };
}
