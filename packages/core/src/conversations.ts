import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { clientMessages, clients, staff } from '@nemo/db';
import { requireStaff, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import { generateReferralCode } from './referral-code.js';
import type { Notification } from './notifications.js';

/**
 * Переписка клиента с менеджером.
 *
 * Клиент пишет боту, менеджер отвечает из панели, доставляет ответ тот
 * же бот, которого клиент запускал сам. Причина не в удобстве: у
 * клиента с закрытыми личными сообщениями менеджер не может написать
 * первым, а бот доходит всегда.
 *
 * Лента одна на клиента: тредов по заявкам нет — у клиента в Telegram
 * одно окно, и тред существовал бы только на стороне менеджера.
 * Сообщение может ссылаться на заявку, но лента остаётся общей.
 *
 * Неотвеченным считается клиент, у которого последнее сообщение
 * входящее. Отдельного поля состояния для этого нет: оно требовало бы
 * согласия с самой лентой, а расходится такое согласие молча. Порядок
 * при этом задаёт сквозной номер, а не время создания: две записи в
 * одну миллисекунду время не разводит, а от порядка зависит ответ на
 * вопрос «ждёт ли клиент».
 */

export interface MessageView {
  readonly id: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly body: string | null;
  /** Есть ли вложение. Само изображение панель подтягивает отдельно. */
  readonly hasAttachment: boolean;
  /** Кто из сотрудников ответил. Пусто у входящих. */
  readonly authorStaffId: string | null;
  readonly authorName: string | null;
  readonly exchangeRequestId: string | null;
  readonly createdAt: Date;
}

/** Строка списка обращений: с кем разговор и ждёт ли он ответа. */
export interface ConversationView {
  readonly clientId: bigint;
  readonly username: string | null;
  readonly lastMessageAt: Date;
  readonly lastMessageBody: string | null;
  /** Последнее сообщение — входящее: клиент ждёт ответа. */
  readonly isUnanswered: boolean;
}

export interface ReceiveMessageInput {
  readonly telegramUserId: bigint;
  readonly body?: string | undefined;
  /** Идентификатор файла у Telegram. Сам файл сервис не скачивает. */
  readonly attachmentFileId?: string | undefined;
  readonly username?: string | undefined;
}

export interface ReceiveMessageResult {
  readonly message: MessageView;
  readonly notifications: readonly Notification[];
}

export interface ReplyInput {
  readonly clientId: bigint;
  readonly body: string;
  /** Заявка, о которой речь. Ленту не делит — только помечает сообщение. */
  readonly exchangeRequestId?: string | undefined;
}

type MessageRow = typeof clientMessages.$inferSelect;

function toView(row: MessageRow, authorName: string | null = null): MessageView {
  return {
    id: row.id,
    direction: row.direction,
    body: row.body,
    hasAttachment: row.attachmentFileId !== null,
    authorStaffId: row.authorStaffId,
    authorName,
    exchangeRequestId: row.exchangeRequestId,
    createdAt: row.createdAt,
  };
}

/**
 * Номер последнего исходящего сообщения клиенту — граница текущей
 * череды его обращений. Всё, что пришло после него, клиент написал, не
 * получив ответа.
 */
function lastOutgoingSeq(clientId: bigint) {
  return sql`coalesce((
    select max(${clientMessages.seq}) from ${clientMessages}
    where ${clientMessages.clientId} = ${clientId}
      and ${clientMessages.direction} = 'outgoing'
  ), 0)`;
}

/**
 * Сообщение клиента боту.
 *
 * Подтверждение приёма отправляется один раз на череду: право на него
 * занимается тем же условным изменением, что и порождает уведомление,
 * — иначе два сообщения подряд дадут два одинаковых ответа. Оно же
 * решает, сообщать ли сотрудникам: повторные сообщения того же клиента
 * до ответа нового обращения не создают.
 */
export async function receiveClientMessage(
  ctx: CoreConfig,
  input: ReceiveMessageInput,
): Promise<ReceiveMessageResult> {
  const body = input.body?.trim() || undefined;
  if (!body && !input.attachmentFileId) {
    throw new InvalidInputError('Пустое сообщение');
  }

  return ctx.db.transaction(async (tx) => {
    // Клиент мог ни разу не открыть приложение: его заводит первое же
    // сообщение боту. Реферера при этом не появляется — привязка идёт
    // там, где `telegram_user_id` подтверждён подписью данных запуска.
    // Username обновляется: в Telegram он меняется, а менеджер по нему
    // узнаёт, с кем говорит.
    await tx
      .insert(clients)
      .values({
        telegramUserId: input.telegramUserId,
        username: input.username ?? null,
        // Код случайный, как и при обычной регистрации: собранный из
        // Telegram клиента, он раскрывал бы его каждому, кому клиент
        // пришлёт ссылку, и угадывался бы по чужому коду.
        referralCode: generateReferralCode(),
      })
      .onConflictDoUpdate({
        target: clients.telegramUserId,
        set: { username: input.username ?? null },
        setWhere: sql`${clients.username} is distinct from ${input.username ?? null}`,
      });

    /*
     * Строка клиента блокируется до конца транзакции. Без блокировки два
     * сообщения, пришедших одновременно, читают ленту каждое в своём
     * снимке, не видят чужой незакоммиченной строки и оба занимают право
     * на подтверждение — клиент получает два одинаковых ответа, а
     * сотрудники два уведомления об одном обращении. Проверка «не
     * подтверждали ли уже» без неё не защищает ни от чего.
     */
    await tx
      .select({ id: clients.telegramUserId })
      .from(clients)
      .where(eq(clients.telegramUserId, input.telegramUserId))
      .limit(1)
      .for('update');

    const [row] = await tx
      .insert(clientMessages)
      .values({
        clientId: input.telegramUserId,
        direction: 'incoming',
        body: body ?? null,
        attachmentFileId: input.attachmentFileId ?? null,
      })
      .returning();

    // Право на подтверждение занимается условно: если в текущей череде
    // подтверждение уже уходило, обновление не найдёт строки, и второго
    // сообщения клиент не получит.
    const [claimed] = await tx
      .update(clientMessages)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          eq(clientMessages.id, row!.id),
          sql`not exists (
            select 1 from ${clientMessages} prior
            where prior.client_id = ${input.telegramUserId}
              and prior.acknowledged_at is not null
              and prior.id <> ${row!.id}
              and prior.seq > ${lastOutgoingSeq(input.telegramUserId)}
          )`,
        ),
      )
      .returning({ id: clientMessages.id });

    return {
      message: toView(row!),
      notifications: claimed
        ? [{ kind: 'client-message-received' as const, to: input.telegramUserId }]
        : [],
    };
  });
}

/**
 * Ответ менеджера. Сохраняется исходящим и возвращает уведомление для
 * доставки: доставку выполняет адаптер, как у переходов заявки.
 */
export async function replyToClient(
  ctx: CoreConfig,
  actor: Actor,
  input: ReplyInput,
): Promise<{ message: MessageView; notifications: readonly Notification[] }> {
  const staffActor = requireStaff(actor);
  const body = input.body.trim();
  if (!body) {
    throw new InvalidInputError('Пустой ответ клиенту не отправляется');
  }

  return ctx.db.transaction(async (tx) => {
    const [client] = await tx
      .select({ id: clients.telegramUserId })
      .from(clients)
      .where(eq(clients.telegramUserId, input.clientId))
      .limit(1);
    if (!client) {
      throw new NotFoundError('Клиент не найден');
    }

    const [row] = await tx
      .insert(clientMessages)
      .values({
        clientId: input.clientId,
        direction: 'outgoing',
        body,
        authorStaffId: staffActor.staffId,
        exchangeRequestId: input.exchangeRequestId ?? null,
      })
      .returning();

    return {
      message: toView(row!),
      notifications: [
        { kind: 'manager-message', to: input.clientId, body },
      ],
    };
  });
}

/**
 * Лента клиента для панели. Сотруднику видна целиком: разговор читают,
 * а не выбирают из него куски.
 */
export async function listConversation(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
): Promise<readonly MessageView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select({ message: clientMessages, authorName: staff.displayName })
    .from(clientMessages)
    .leftJoin(staff, eq(staff.id, clientMessages.authorStaffId))
    .where(eq(clientMessages.clientId, clientId))
    .orderBy(clientMessages.seq);

  return rows.map((row) => toView(row.message, row.authorName));
}

/**
 * Клиенты, с которыми есть переписка, — от ждущих ответа к остальным.
 *
 * «Последнее сообщение» берётся по сквозному номеру: время создания не
 * разводит две записи, вставленные в одну миллисекунду.
 */
export async function listConversations(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly ConversationView[]> {
  requireStaff(actor);

  const last = ctx.db.$with('last').as(
    ctx.db
      .selectDistinctOn([clientMessages.clientId], {
        clientId: clientMessages.clientId,
        direction: clientMessages.direction,
        body: clientMessages.body,
        createdAt: clientMessages.createdAt,
        seq: clientMessages.seq,
      })
      .from(clientMessages)
      .orderBy(clientMessages.clientId, desc(clientMessages.seq)),
  );

  const rows = await ctx.db
    .with(last)
    .select({
      clientId: last.clientId,
      username: clients.username,
      lastMessageAt: last.createdAt,
      lastMessageBody: last.body,
      direction: last.direction,
    })
    .from(last)
    .innerJoin(clients, eq(clients.telegramUserId, last.clientId))
    // Ждущие ответа сверху: это работа, а не история. Внутри — по
    // сквозному номеру, тому же, которым определяется последнее
    // сообщение: время двух записей в одну миллисекунду не разводит.
    .orderBy(sql`${last.direction} = 'incoming' desc`, desc(last.seq));

  return rows.map(({ direction, ...row }) => ({
    ...row,
    isUnanswered: direction === 'incoming',
  }));
}

/**
 * Сколько клиентов ждут ответа. Запросом за числом, а не выборкой всей
 * переписки: счётчик рисуется в меню на каждом переходе между
 * разделами, и тянуть ради него ленты целиком незачем.
 */
export async function countUnansweredConversations(
  ctx: CoreConfig,
  actor: Actor,
): Promise<number> {
  requireStaff(actor);
  const [row] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(
      ctx.db
        .selectDistinctOn([clientMessages.clientId], {
          clientId: clientMessages.clientId,
          direction: clientMessages.direction,
        })
        .from(clientMessages)
        .orderBy(clientMessages.clientId, desc(clientMessages.seq))
        .as('last'),
    )
    .where(sql`last.direction = 'incoming'`);

  return row?.count ?? 0;
}

/**
 * Обращения, о которых сотрудникам ещё не сообщали.
 *
 * Отдельным вызовом, а не частью приёма сообщения: уведомляет
 * сотрудников бот входа в админку, и его токен лежит только в деплое
 * панели — клиентское приложение, принимающее сообщение, отправить их
 * не может (docs/adr/0005).
 *
 * Отметка ставится тем же условным изменением, что и порождает
 * уведомления: два наложившихся вызова иначе разошлют одно обращение
 * дважды.
 */
export async function takeStaffNotifications(
  ctx: CoreConfig,
  at: Date,
): Promise<readonly Notification[]> {
  return ctx.db.transaction(async (tx) => {
    const fresh = await tx
      .update(clientMessages)
      .set({ staffNotifiedAt: at })
      .where(
        and(
          eq(clientMessages.direction, 'incoming'),
          // Подтверждение клиенту и уведомление сотрудникам — про одно
          // и то же: начало череды. Повторные сообщения до ответа его
          // не занимают и сотрудников не беспокоят.
          isNotNull(clientMessages.acknowledgedAt),
          isNull(clientMessages.staffNotifiedAt),
        ),
      )
      .returning();

    if (fresh.length === 0) return [];

    const recipients = await tx
      .select({ telegramUserId: staff.telegramUserId })
      .from(staff)
      .where(eq(staff.isActive, true));

    // Имена только тех, чьи обращения уходят: вся таблица клиентов ради
    // нескольких строк — цена, которую платят на каждом опросе.
    const senders = await tx
      .select({ telegramUserId: clients.telegramUserId, username: clients.username })
      .from(clients)
      .where(inArray(clients.telegramUserId, [...new Set(fresh.map((one) => one.clientId))]));
    const usernames = new Map(senders.map((one) => [one.telegramUserId, one.username]));

    return fresh.flatMap((message) =>
      recipients.map(
        (recipient): Notification => ({
          kind: 'staff-client-message',
          to: recipient.telegramUserId,
          clientId: message.clientId,
          clientUsername: usernames.get(message.clientId) ?? null,
          preview: message.body ?? 'Изображение',
        }),
      ),
    );
  });
}
