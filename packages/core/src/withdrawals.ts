import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { open } from '@nemo/crypto';
import {
  bonusTransactions,
  clientRequisites,
  clients,
  staff,
  withdrawalRequests,
} from '@nemo/db';
import {
  canTransitionWithdrawal,
  Money,
  withdrawalRequestStatuses,
  isWithdrawalOpen,
  type Amount,
  type RequisiteKind,
  type WithdrawalMethod,
  type WithdrawalRequestStatus,
} from '@nemo/types';
import { requireClient, requireStaff, type Actor } from './actor.js';
import { requirePositiveAmount } from './amounts.js';
import { bonusBalance } from './bonus-account.js';
import { CLIENT_HISTORY_LIMIT } from './client-history.js';
import { requirePrivateKey, type CoreConfig, type Executor } from './context.js';
import { InvalidInputError, NotFoundError, TransitionNotAllowedError } from './errors.js';
import { requireActiveNetwork } from './networks.js';
import type { Notification } from './notifications.js';
import { logRequisiteAccess } from './requisite-access.js';
import { describeRequisites } from './requisites.js';
import { readServiceSettings } from './settings.js';

/**
 * Заявка на вывод бонусных баллов.
 *
 * Выплату исполняет менеджер вручную, как и всё остальное движение денег
 * в сервисе: автоматических выплат в криптовалюте в этой фазе нет
 * сознательно.
 *
 * Баллы списываются в момент отметки о выплате, а не при подаче заявки.
 * Списание вперёд означало бы, что отклонённая заявка обязана вернуть
 * баллы обратно, — а возврат, не выполненный из-за сбоя, оставил бы
 * клиента без них навсегда. Пока заявка в работе, её сумма считается
 * занятой: подать вторую на те же баллы нельзя.
 *
 * Реквизиты получения шифруются тем же ключом, что и номера карт
 * (docs/adr/0002): в клиентском деплое приватного ключа нет, и прочитать
 * их может только админка.
 */

export interface WithdrawalRequestView {
  readonly id: string;
  readonly clientId: bigint;
  readonly amount: Amount;
  readonly method: WithdrawalMethod;
  /** Сеть перевода из справочника. У выплаты на банковский счёт её нет. */
  readonly network: string | null;
  /** Всё, что видно о реквизитах получения без расшифровки. */
  readonly destinationHint: string | null;
  readonly status: WithdrawalRequestStatus;
  readonly rejectReason: string | null;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
}

export interface SubmitWithdrawalInput {
  readonly amount: string;
  /**
   * Куда перечислить — запись из списка реквизитов клиента, того же, из
   * которого он выбирает при обмене.
   *
   * Ни способа, ни сети рядом нет: и то и другое у записи уже есть, а
   * присланное поверх означало бы, что клиент может назвать сети
   * кошелька не ту, в которой кошелёк заведён.
   */
  readonly requisitesId: string;
}

export interface WithdrawalTransitionResult {
  readonly request: WithdrawalRequestView;
  readonly notifications: readonly Notification[];
}

/**
 * Та же заявка в очереди менеджера — с ником клиента.
 *
 * Ник не поле заявки, а подпись к ней: в очереди из десятка строк
 * «клиент 379336096» не отличается от соседнего номера. Клиенту это
 * представление не отдаётся — свой ник он и так знает.
 */
export type ManagerWithdrawalView = WithdrawalRequestView & {
  readonly clientUsername: string | null;
  /**
   * Кто ведёт выплату — именем. Очередь общая, и «кто взял» здесь не
   * приватность, а рабочая информация: без неё двое звонят одному
   * клиенту.
   */
  readonly managerName: string | null;
};

type WithdrawalRow = typeof withdrawalRequests.$inferSelect;

/** Состояния, в которых заявка ещё занимает баллы клиента. */
const OPEN_STATUSES = withdrawalRequestStatuses.filter(isWithdrawalOpen);

function toView(row: WithdrawalRow): WithdrawalRequestView {
  return {
    id: row.id,
    clientId: row.clientId,
    amount: Money.toAmount(row.amount),
    method: row.method,
    network: row.network,
    destinationHint: row.destinationHint,
    status: row.status,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
  };
}

function notificationFor(row: WithdrawalRow): Notification {
  return {
    kind: 'withdrawal-request-status',
    to: row.clientId,
    status: row.status,
    amount: Money.toAmount(row.amount),
    ...(row.rejectReason === null ? {} : { rejectReason: row.rejectReason }),
  };
}

/**
 * Каким способом уходит выплата — решает вид записи, а не клиент.
 *
 * Перевод по телефону и на карту исполняются одинаково: менеджер
 * отправляет деньги через банк. Кошелёк — это криптовалюта, и другого
 * способа у него нет.
 */
function methodOf(kind: RequisiteKind): WithdrawalMethod {
  return kind === 'wallet' ? 'crypto' : 'bank';
}

/**
 * Реквизит одной строкой — так, как его читает менеджер перед выплатой.
 *
 * Целиком, а не одним расшифрованным номером: банк без номера карты
 * бесполезен, номер без банка — тоже. У перевода по телефону
 * расшифровывать нечего, там оба поля и так открыты.
 */
function revealed(
  requisites: typeof clientRequisites.$inferSelect,
  privateKey: string,
): string {
  switch (requisites.kind) {
    case 'phone':
      return [requisites.bankName, requisites.phone].filter(Boolean).join(' · ');
    case 'card':
      return [
        requisites.bankName,
        requisites.cardSealed ? open(privateKey, requisites.cardSealed) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'wallet':
      return [
        requisites.network,
        requisites.addressSealed ? open(privateKey, requisites.addressSealed) : null,
      ]
        .filter(Boolean)
        .join(' · ');
  }
}

/**
 * Сколько клиент может вывести прямо сейчас: баланс за вычетом сумм,
 * уже заявленных к выводу.
 *
 * Без вычета две заявки, поданные подряд, вывели бы один и тот же
 * остаток дважды — списание-то происходит только при выплате.
 */
async function availableForWithdrawal(
  executor: Executor,
  clientId: bigint,
): Promise<Amount> {
  const balance = await bonusBalance(executor, clientId);
  const [row] = await executor
    .select({ total: sql<string | null>`sum(${withdrawalRequests.amount})` })
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.clientId, clientId),
        inArray(withdrawalRequests.status, OPEN_STATUSES),
      ),
    );

  const held = row?.total == null ? Money.ZERO : Money.toAmount(row.total);
  return Money.subtract(balance, held);
}

export async function submitWithdrawalRequest(
  ctx: CoreConfig,
  actor: Actor,
  input: SubmitWithdrawalInput,
): Promise<WithdrawalTransitionResult> {
  const clientId = requireClient(actor);
  const amount = requirePositiveAmount(input.amount, 'Сумма вывода');

  return ctx.db.transaction(async (tx) => {
    /*
     * Реквизит берётся из списка клиента и проверяется здесь же: чужая
     * запись — это выплата не тому, а архивная — та, которой клиент уже
     * не пользуется. Отбор по владельцу, а не проверка после чтения:
     * «не найдено» для чужой записи не подтверждает, что она есть.
     */
    const [requisites] = await tx
      .select()
      .from(clientRequisites)
      .where(
        and(
          eq(clientRequisites.id, input.requisitesId),
          eq(clientRequisites.clientId, clientId),
          isNull(clientRequisites.archivedAt),
        ),
      )
      .limit(1);
    if (!requisites) {
      throw new NotFoundError('Реквизиты не найдены');
    }

    // Сеть могла быть выключена после того, как клиент завёл кошелёк:
    // принять такую заявку значит завести выплату, которую некому
    // исполнить.
    if (requisites.network) {
      await requireActiveNetwork(tx, requisites.network);
    }

    // Строка клиента блокируется на время подсчёта: две заявки,
    // поданные одновременно, иначе прочитали бы один и тот же остаток и
    // обе прошли бы проверку.
    const [client] = await tx
      .select({ id: clients.telegramUserId })
      .from(clients)
      .where(eq(clients.telegramUserId, clientId))
      .limit(1)
      .for('update');
    if (!client) {
      throw new NotFoundError('Клиент не найден');
    }

    const settings = await readServiceSettings(tx);
    if (Money.compare(amount, settings.minWithdrawalAmount) < 0) {
      throw new InvalidInputError(
        `Минимальная сумма вывода — ${settings.minWithdrawalAmount} баллов`,
      );
    }

    const available = await availableForWithdrawal(tx, clientId);
    if (Money.compare(amount, available) > 0) {
      throw new InvalidInputError(
        `На бонусном балансе доступно ${available} баллов`,
      );
    }

    const [row] = await tx
      .insert(withdrawalRequests)
      .values({
        clientId,
        amount,
        method: methodOf(requisites.kind),
        // Сеть — только у кошелька: у карты и телефона её нет, и «TRC20»
        // рядом с номером карты читался бы как ошибка ввода.
        network: requisites.network,
        requisitesId: requisites.id,
        // Подпись та же, по которой запись называется клиенту и в
        // журнале доступа: менеджер видит, куда заявлен вывод, не
        // открывая сам реквизит.
        destinationHint: describeRequisites(requisites),
      })
      .returning();

    return { request: toView(row!), notifications: [notificationFor(row!)] };
  });
}

export async function listWithdrawalRequests(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly WithdrawalRequestView[]> {
  const clientId = requireClient(actor);
  const rows = await ctx.db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.clientId, clientId))
    .orderBy(desc(withdrawalRequests.createdAt))
    .limit(CLIENT_HISTORY_LIMIT);
  return rows.map(toView);
}

/** Очередь выплат: заявки, которые ещё в работе. */
export async function listWithdrawalQueue(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly ManagerWithdrawalView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select({
      request: withdrawalRequests,
      username: clients.username,
      managerName: staff.displayName,
    })
    .from(withdrawalRequests)
    .innerJoin(clients, eq(clients.telegramUserId, withdrawalRequests.clientId))
    .leftJoin(staff, eq(staff.id, withdrawalRequests.managerId))
    .where(inArray(withdrawalRequests.status, OPEN_STATUSES))
    .orderBy(desc(withdrawalRequests.createdAt));
  return rows.map((row) => ({
    ...toView(row.request),
    clientUsername: row.username,
    managerName: row.managerName,
  }));
}

async function lockWithdrawal(
  executor: Executor,
  requestId: string,
): Promise<WithdrawalRow> {
  const [row] = await executor
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.id, requestId))
    .limit(1)
    .for('update');
  if (!row) {
    throw new NotFoundError('Заявка на вывод не найдена');
  }
  return row;
}

interface WithdrawalPatch {
  readonly rejectReason?: string;
  readonly paidAt?: Date;
}

async function transition(
  executor: Executor,
  row: WithdrawalRow,
  to: WithdrawalRequestStatus,
  staffId: string,
  patch: WithdrawalPatch = {},
): Promise<WithdrawalRow> {
  if (!canTransitionWithdrawal(row.status, to)) {
    throw new TransitionNotAllowedError(
      `Заявку на вывод из состояния «${row.status}» нельзя перевести в «${to}»`,
    );
  }

  const [updated] = await executor
    .update(withdrawalRequests)
    .set({ ...patch, status: to, managerId: staffId })
    .where(eq(withdrawalRequests.id, row.id))
    .returning();
  return updated!;
}

export async function approveWithdrawalRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<WithdrawalTransitionResult> {
  const staff = requireStaff(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockWithdrawal(tx, requestId);
    const updated = await transition(tx, row, 'approved', staff.staffId);
    return { request: toView(updated), notifications: [notificationFor(updated)] };
  });
}

/**
 * Отметка о выплате — единственное место, где баллы списываются.
 *
 * Списание и смена состояния идут одной транзакцией: заявка,
 * помеченная выплаченной без списания, оставила бы клиенту баллы,
 * которые он уже получил деньгами.
 */
export async function markWithdrawalPaid(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<WithdrawalTransitionResult> {
  const staff = requireStaff(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockWithdrawal(tx, requestId);
    const updated = await transition(tx, row, 'paid', staff.staffId, { paidAt: new Date() });

    // Отрицательной величиной, а не отдельным знаком у движения: баланс
    // — сумма движений, и правило «одни виды сложить, другие вычесть»
    // разошлось бы между местами, где баланс считают.
    await tx.insert(bonusTransactions).values({
      clientId: row.clientId,
      kind: 'withdrawal',
      amount: Money.subtract(Money.ZERO, Money.toAmount(row.amount)),
      withdrawalRequestId: row.id,
    });

    return { request: toView(updated), notifications: [notificationFor(updated)] };
  });
}

export async function rejectWithdrawalRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
  input: { reason?: string | undefined } = {},
): Promise<WithdrawalTransitionResult> {
  const staff = requireStaff(actor);
  const reason = input.reason?.trim();
  if (!reason) {
    // Клиент должен понимать, что исправить, чтобы подать заново.
    throw new InvalidInputError('Укажите причину отказа');
  }

  return ctx.db.transaction(async (tx) => {
    const row = await lockWithdrawal(tx, requestId);
    const updated = await transition(tx, row, 'rejected', staff.staffId, {
      rejectReason: reason,
    });
    return { request: toView(updated), notifications: [notificationFor(updated)] };
  });
}

/**
 * Реквизиты получения — менеджеру, который выполняет выплату.
 *
 * Отдельной операцией, а не полем в списке заявок: расшифрованный
 * реквизит не должен уезжать на экран очереди просто потому, что
 * менеджер её открыл.
 *
 * Обращение попадает в тот же журнал, что и чтение номера карты
 * (docs/adr/0002), и в той же транзакции: счёт, на который клиент
 * просит выплату, — такой же его реквизит, и след от чтения нужен по
 * той же причине.
 */
export async function revealWithdrawalDestination(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<string> {
  const staff = requireStaff(actor);
  const privateKey = requirePrivateKey(ctx);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        clientId: withdrawalRequests.clientId,
        requisitesId: withdrawalRequests.requisitesId,
        destinationSealed: withdrawalRequests.destinationSealed,
      })
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, requestId))
      .limit(1);

    if (!row) {
      throw new NotFoundError('Заявка на вывод не найдена');
    }

    await logRequisiteAccess(tx, {
      staffId: staff.staffId,
      clientId: row.clientId,
      withdrawalRequestId: requestId,
    });

    /*
     * Заявка ссылается на запись клиента — открывается она. Собственный
     * шифротекст остался у заявок, поданных до того, как список стал
     * общим: у них записи-реквизита нет, и читать нечего, кроме него.
     */
    if (row.requisitesId) {
      const [requisites] = await tx
        .select()
        .from(clientRequisites)
        .where(eq(clientRequisites.id, row.requisitesId))
        .limit(1);
      if (!requisites) {
        throw new NotFoundError('Реквизиты не найдены');
      }

      return revealed(requisites, privateKey);
    }

    if (!row.destinationSealed) {
      throw new NotFoundError('У заявки на вывод не сохранены реквизиты получения');
    }
    return open(privateKey, row.destinationSealed);
  });
}
