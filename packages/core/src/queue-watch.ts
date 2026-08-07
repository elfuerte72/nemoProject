import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { clientMessages, clients, exchangeRequests, staff } from '@nemo/db';
import { Money } from '@nemo/types';
import type { CoreConfig } from './context.js';
import type { Notification } from './notifications.js';

/**
 * Сторож очереди: что залежалось.
 *
 * Уведомление о новой заявке уходит один раз, и на этом сервис о ней
 * замолкает. Дальше она может простоять час — потому что смена
 * сменилась, потому что сообщение прокрутилось в чате, потому что
 * менеджер решил «возьму через минуту». Заметит это клиент.
 *
 * Правила нарочно тупые: время и состояние, без оценки важности. Сторож,
 * решающий, какая заявка важнее, — это второй продукт; здесь нужен один
 * вопрос, «об этом уже забыли?», и ответ на него виден из двух полей.
 *
 * Напоминание уходит однажды на повод. Повторять его каждый прогон —
 * значит через день выучить, что уведомления от панели можно не читать.
 */

/**
 * Сколько заявка ждёт хозяина, прежде чем о ней напомнить.
 *
 * Полчаса: меньше — и напоминание придёт менеджеру, который сейчас
 * разбирает предыдущую заявку; больше — и клиент успеет спросить
 * первым. Числом в коде, а не настройкой: это не деньги, а вопрос о
 * том, как устроена смена, — а смены пока нет (`backlog.md`).
 */
const STALE_REQUEST_MINUTES = 30;

/** Сколько клиент ждёт ответа, прежде чем о нём напомнить. */
const WAITING_CLIENT_MINUTES = 30;

export async function takeQueueWatchAlerts(
  ctx: CoreConfig,
  at: Date,
): Promise<readonly Notification[]> {
  return ctx.db.transaction(async (tx) => {
    const recipients = await tx
      .select({ telegramUserId: staff.telegramUserId })
      .from(staff)
      .where(eq(staff.isActive, true));

    // Некому напоминать — не о чем и говорить. Отметку при этом не
    // ставим: заявка, залежавшаяся до найма менеджера, ждёт дольше всех.
    if (recipients.length === 0) return [];

    return [
      ...(await remindAboutStaleRequests(tx, at, recipients)),
      ...(await remindAboutWaitingClients(tx, at, recipients)),
    ];
  });
}

type Transaction = Parameters<Parameters<CoreConfig['db']['transaction']>[0]>[0];
type Recipient = { readonly telegramUserId: bigint };

/** Порог в виде момента: всё, что старше, залежалось. */
function olderThan(at: Date, minutes: number): Date {
  return new Date(at.getTime() - minutes * 60 * 1000);
}

function waitedMinutes(since: Date, at: Date): number {
  return Math.floor((at.getTime() - since.getTime()) / 60_000);
}

/**
 * Заявки без хозяина, о которых уже сообщали и ещё не напоминали.
 *
 * `staffNotifiedAt` в условии не случайно: напоминать о заявке, о
 * которой ещё не сообщили, значит сообщать о ней задом наперёд — сперва
 * «её никто не взял», потом «она появилась».
 */
async function remindAboutStaleRequests(
  tx: Transaction,
  at: Date,
  recipients: readonly Recipient[],
): Promise<readonly Notification[]> {
  const stale = await tx
    .update(exchangeRequests)
    .set({ staleAlertedAt: at })
    .where(
      and(
        // «Новая» и без хозяина — два способа сказать одно, и держатся
        // они порознь: заявку можно взять, не сменив состояния.
        eq(exchangeRequests.status, 'new'),
        isNull(exchangeRequests.assignedManagerId),
        isNull(exchangeRequests.staleAlertedAt),
        isNotNull(exchangeRequests.staffNotifiedAt),
        lt(exchangeRequests.createdAt, olderThan(at, STALE_REQUEST_MINUTES)),
      ),
    )
    .returning();

  if (stale.length === 0) return [];

  const usernames = await usernamesOf(tx, stale.map((one) => one.clientId));

  return stale.flatMap((row) =>
    recipients.map(
      (recipient): Notification => ({
        kind: 'staff-stale-request',
        to: recipient.telegramUserId,
        clientId: row.clientId,
        clientUsername: usernames.get(row.clientId) ?? null,
        request: {
          kind: 'exchange',
          id: row.id,
          fromAmount: Money.toAmount(row.fromAmount),
          fromCode: row.fromCode,
          toCode: row.toCode,
          isCash: row.kind === 'cash',
        },
        waitingMinutes: waitedMinutes(row.createdAt, at),
      }),
    ),
  );
}

/**
 * Клиенты, чьё последнее сообщение — входящее и давнее.
 *
 * «Ждёт ответа» здесь то же, что и в списке обращений: последнее
 * сообщение ленты входящее. Отдельного состояния под это не заводится —
 * оно требовало бы согласия с самой лентой, а расходится такое согласие
 * молча.
 */
async function remindAboutWaitingClients(
  tx: Transaction,
  at: Date,
  recipients: readonly Recipient[],
): Promise<readonly Notification[]> {
  /*
   * Отметка ставится тем же изменением, что и порождает напоминания:
   * выбрать, а потом пометить — значит позволить двум наложившимся
   * вызовам (планировщику и толчку из клиентского деплоя) напомнить об
   * одном клиенте дважды.
   */
  const waiting = await tx
    .update(clientMessages)
    .set({ staffRemindedAt: at })
    .where(
      and(
        eq(clientMessages.direction, 'incoming'),
        // О сообщении уже сообщали и ещё не напоминали.
        isNotNull(clientMessages.staffNotifiedAt),
        isNull(clientMessages.staffRemindedAt),
        lt(clientMessages.createdAt, olderThan(at, WAITING_CLIENT_MINUTES)),
        // Последнее в ленте: ответивший менеджер снимает повод, а
        // прежние сообщения клиента — это не «он всё ещё ждёт».
        sql`${clientMessages.seq} = (
          select max(seq) from ${clientMessages} feed
          where feed.client_id = ${clientMessages.clientId}
        )`,
      ),
    )
    .returning();

  if (waiting.length === 0) return [];

  const usernames = await usernamesOf(tx, waiting.map((one) => one.clientId));

  return waiting.flatMap((row) =>
    recipients.map(
      (recipient): Notification => ({
        kind: 'staff-waiting-client',
        to: recipient.telegramUserId,
        clientId: row.clientId,
        clientUsername: usernames.get(row.clientId) ?? null,
        preview: row.body ?? 'Изображение',
        waitingMinutes: waitedMinutes(row.createdAt, at),
      }),
    ),
  );
}

/**
 * Имена только тех клиентов, о ком напоминаем: вся таблица ради
 * нескольких строк — цена, которую платят на каждом прогоне.
 */
async function usernamesOf(
  tx: Transaction,
  clientIds: readonly bigint[],
): Promise<Map<bigint, string | null>> {
  const rows = await tx
    .select({ telegramUserId: clients.telegramUserId, username: clients.username })
    .from(clients)
    .where(inArray(clients.telegramUserId, [...new Set(clientIds)]));

  return new Map(rows.map((one) => [one.telegramUserId, one.username]));
}
