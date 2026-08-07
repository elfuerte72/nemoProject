import { eq, inArray, isNull } from 'drizzle-orm';
import { Money } from '@nemo/types';
import {
  cardApplications,
  clients,
  exchangeRequests,
  staff,
  withdrawalRequests,
} from '@nemo/db';
import type { CoreConfig } from './context.js';
import { takeStaffNotifications } from './conversations.js';
import type { NewRequestSubject, Notification } from './notifications.js';
import { takeQueueWatchAlerts } from './queue-watch.js';

/**
 * О чём сотрудникам ещё не сообщали.
 *
 * Один вызов на всё: обращения клиентов, новые заявки — обмен, вывод,
 * карта — и напоминания о том, что залежалось. Планировщику незачем
 * знать, сколько поводов позвать менеджера существует в сервисе;
 * появившийся шестой должен доехать до него без правки расписания.
 *
 * Отправляет уведомления бот входа в админку, и его токен лежит только
 * в деплое панели (docs/adr/0005) — поэтому операция их возвращает, а
 * не рассылает: доставку выполняет адаптер, как и у переходов заявки.
 *
 * Отметка о рассылке ставится тем же условным изменением, что и
 * порождает уведомления: два наложившихся вызова иначе разошлют одну
 * заявку дважды.
 */
export async function takeStaffAlerts(
  ctx: CoreConfig,
  at: Date,
): Promise<readonly Notification[]> {
  const messages = await takeStaffNotifications(ctx, at);
  const requests = await takeNewRequestNotifications(ctx, at);
  // Напоминания последними: если в этом же прогоне появилась новая
  // заявка, менеджер прочитает сперва о ней, а потом о забытой — в том
  // порядке, в каком они случились.
  const forgotten = await takeQueueWatchAlerts(ctx, at);
  return [...messages, ...requests, ...forgotten];
}

/** Строка заявки, приведённая к тому, чем она называется сотруднику. */
interface PendingRequest {
  readonly clientId: bigint;
  readonly subject: NewRequestSubject;
}

type Transaction = Parameters<Parameters<CoreConfig['db']['transaction']>[0]>[0];

async function takeNewRequestNotifications(
  ctx: CoreConfig,
  at: Date,
): Promise<readonly Notification[]> {
  return ctx.db.transaction(async (tx) => {
    const recipients = await tx
      .select({ telegramUserId: staff.telegramUserId })
      .from(staff)
      .where(eq(staff.isActive, true));

    /*
     * Сообщать некому. Отметка при этом не ставится: иначе заявка,
     * поданная до того, как завели первого сотрудника, не была бы
     * сообщена никогда — а именно она и ждёт дольше всех.
     */
    if (recipients.length === 0) return [];

    const taken = [
      ...(await takeExchangeRequests(tx, at)),
      ...(await takeWithdrawalRequests(tx, at)),
      ...(await takeCardApplications(tx, at)),
    ];
    if (taken.length === 0) return [];

    // Имена только тех клиентов, чьи заявки уходят: вся таблица ради
    // нескольких строк — цена, которую платят на каждом опросе.
    const owners = await tx
      .select({ telegramUserId: clients.telegramUserId, username: clients.username })
      .from(clients)
      .where(inArray(clients.telegramUserId, [...new Set(taken.map((one) => one.clientId))]));
    const usernames = new Map(owners.map((one) => [one.telegramUserId, one.username]));

    return taken.flatMap((request) =>
      recipients.map(
        (recipient): Notification => ({
          kind: 'staff-new-request',
          to: recipient.telegramUserId,
          clientId: request.clientId,
          clientUsername: usernames.get(request.clientId) ?? null,
          request: request.subject,
        }),
      ),
    );
  });
}

/*
 * Отметку занимает всякая несообщённая заявка, а уведомление порождает
 * только та, что ещё никем не взята и не отменена.
 *
 * Разделено намеренно, и потому одинаково во всех трёх. Отбор по
 * состоянию прямо в условии оставлял бы взятую заявку без отметки
 * навсегда, и опрос перечитывал бы её каждые полминуты до скончания
 * века. А звать менеджера словом «новая» к заявке, которую он уже
 * ведёт, — значит звать его к сделанному.
 */

async function takeExchangeRequests(
  tx: Transaction,
  at: Date,
): Promise<readonly PendingRequest[]> {
  const rows = await tx
    .update(exchangeRequests)
    .set({ staffNotifiedAt: at })
    .where(isNull(exchangeRequests.staffNotifiedAt))
    .returning();

  return rows
    .filter((row) => row.status === 'new')
    .map((row) => ({
      clientId: row.clientId,
      subject: {
        kind: 'exchange',
        id: row.id,
        fromAmount: Money.toAmount(row.fromAmount),
        fromCode: row.fromCode,
        toCode: row.toCode,
        isCash: row.kind === 'cash',
      },
    }));
}

async function takeWithdrawalRequests(
  tx: Transaction,
  at: Date,
): Promise<readonly PendingRequest[]> {
  const rows = await tx
    .update(withdrawalRequests)
    .set({ staffNotifiedAt: at })
    .where(isNull(withdrawalRequests.staffNotifiedAt))
    .returning();

  return rows
    .filter((row) => row.status === 'new')
    .map((row) => ({
      clientId: row.clientId,
      subject: { kind: 'withdrawal', id: row.id, amount: Money.toAmount(row.amount) },
    }));
}

async function takeCardApplications(
  tx: Transaction,
  at: Date,
): Promise<readonly PendingRequest[]> {
  const rows = await tx
    .update(cardApplications)
    .set({ staffNotifiedAt: at })
    .where(isNull(cardApplications.staffNotifiedAt))
    .returning();

  return rows
    .filter((row) => row.status === 'submitted')
    .map((row) => ({
      clientId: row.clientId,
      subject: { kind: 'card', id: row.id },
    }));
}
