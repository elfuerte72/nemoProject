import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { clientMessages, clients, staff } from '@nemo/db';
import { requireStaff, type Actor } from './actor.js';
import { conciergeTakesOver } from './concierge.js';
import type { CoreConfig } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import { generateReferralCode } from './referral-code.js';
import type { InquiryTopic } from './inquiries.js';
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
  /**
   * О чём просьба, если это просьба. Пусто у обычного вопроса: тему
   * называет тот, кто пришёл из раздела «За границей».
   */
  readonly topic: InquiryTopic | null;
  readonly body: string | null;
  /** Есть ли вложение. Само изображение панель подтягивает отдельно. */
  readonly hasAttachment: boolean;
  /** Кто из сотрудников ответил. Пусто у входящих и у ответов консьержа. */
  readonly authorStaffId: string | null;
  readonly authorName: string | null;
  /**
   * Ответил консьерж. Менеджер видит это в ленте: вступая в разговор
   * вслепую, он пересказал бы клиенту другую цену.
   */
  readonly byConcierge: boolean;
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
  /**
   * Кто ответил последним. Пусто, пока разговор ждёт ответа: у
   * входящего сообщения автора из сотрудников нет.
   */
  readonly lastAuthorName: string | null;
  /**
   * О чём последняя просьба в этой ленте. Пусто, если просьб не было, —
   * такой разговор про поддержку.
   *
   * Берётся у последней просьбы, а не у последнего сообщения: клиент,
   * попросивший оплатить отель и дописавший «и ещё вопрос», не перестал
   * спрашивать про оплату. Тема — свойство просьбы, а не ленты. Держится
   * она до ответа сервиса: отвеченная просьба разобрана, и разговор
   * снова про поддержку.
   */
  readonly topic: InquiryTopic | null;
  /**
   * Разговор ведёт человек: консьерж в нём молчит. Метка стоит в
   * списке, потому что по ней менеджер видит, чем занята первая линия,
   * не открывая переписку.
   */
  readonly handedToHuman: boolean;
}

export interface ReceiveMessageInput {
  readonly telegramUserId: bigint;
  readonly body?: string | undefined;
  /** Идентификатор файла у Telegram. Сам файл сервис не скачивает. */
  readonly attachmentFileId?: string | undefined;
  readonly username?: string | undefined;
  /** О чём просьба. Ставит её `submitInquiry`; обычное сообщение темы не имеет. */
  readonly topic?: InquiryTopic | undefined;
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
    topic: row.topic,
    body: row.body,
    hasAttachment: row.attachmentFileId !== null,
    authorStaffId: row.authorStaffId,
    authorName,
    byConcierge: row.authoredByConcierge,
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
    const [locked] = await tx
      .select({ handedToHumanAt: clients.handedToHumanAt })
      .from(clients)
      .where(eq(clients.telegramUserId, input.telegramUserId))
      .limit(1)
      .for('update');

    /*
     * Возьмётся ли за это сообщение консьерж. От ответа зависит и то,
     * что получит клиент, и то, узнают ли о сообщении сотрудники.
     *
     * Возьмётся — подтверждение приёма не отправляется: его заменяет
     * живой ответ, и два сообщения подряд превратили бы разговор в
     * переписку с автоответчиком. Сотрудников при этом тоже не зовут:
     * их позовёт эскалация, если она случится.
     */
    const takenByConcierge = conciergeTakesOver(ctx, {
      handedToHumanAt: locked?.handedToHumanAt ?? null,
    });

    const [row] = await tx
      .insert(clientMessages)
      .values({
        clientId: input.telegramUserId,
        direction: 'incoming',
        topic: input.topic ?? null,
        body: body ?? null,
        attachmentFileId: input.attachmentFileId ?? null,
        conciergeOutcome: takenByConcierge ? 'pending' : null,
      })
      .returning();

    if (takenByConcierge) {
      return { message: toView(row!), notifications: [] };
    }

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
/**
 * Чем менеджер сужает список обращений.
 *
 * Тем в отборе две, а в данных больше: отель и покупка — обе про оплату
 * продукта, и вопрос у менеджера к ним один — «где просьбы про деньги».
 * Какая именно просьба, видно в самой строке; дробить отбор по
 * пунктам раздела значило бы спрашивать у него то, чего он не
 * спрашивает.
 *
 * «Поддержка» — это отсутствие темы: обычный вопрос её не называет.
 */
export type ConversationTopicFilter = 'support' | 'payment';

export interface ConversationFilter {
  readonly topic?: ConversationTopicFilter | undefined;
}

export async function listConversations(
  ctx: CoreConfig,
  actor: Actor,
  filter: ConversationFilter = {},
): Promise<readonly ConversationView[]> {
  requireStaff(actor);

  /*
   * Тема последней просьбы в ленте — отдельной выборкой, а не из
   * последнего сообщения: клиент, попросивший оплатить отель и
   * дописавший «и ещё вопрос», спрашивает всё о том же.
   *
   * Но только пока просьбе не ответили. До 4 сентября 2026 тема висела
   * на разговоре навсегда, и «Отель» стоял у «привет» месяц спустя —
   * читалось как тема этого сообщения. Ответ сервиса после просьбы
   * снимает её: разобранная просьба — история, а не работа.
   */
  const topics = ctx.db.$with('topics').as(
    ctx.db
      .selectDistinctOn([clientMessages.clientId], {
        clientId: clientMessages.clientId,
        topic: clientMessages.topic,
        seq: clientMessages.seq,
      })
      .from(clientMessages)
      .where(isNotNull(clientMessages.topic))
      .orderBy(clientMessages.clientId, desc(clientMessages.seq)),
  );

  const answered = ctx.db.$with('answered').as(
    ctx.db
      .selectDistinctOn([clientMessages.clientId], {
        clientId: clientMessages.clientId,
        seq: clientMessages.seq,
      })
      .from(clientMessages)
      .where(eq(clientMessages.direction, 'outgoing'))
      .orderBy(clientMessages.clientId, desc(clientMessages.seq)),
  );

  const openTopic = sql<InquiryTopic | null>`case when ${answered.seq} is null or ${topics.seq} > ${answered.seq} then ${topics.topic} end`;

  const last = ctx.db.$with('last').as(
    ctx.db
      .selectDistinctOn([clientMessages.clientId], {
        clientId: clientMessages.clientId,
        direction: clientMessages.direction,
        body: clientMessages.body,
        createdAt: clientMessages.createdAt,
        seq: clientMessages.seq,
        authorStaffId: clientMessages.authorStaffId,
      })
      .from(clientMessages)
      .orderBy(clientMessages.clientId, desc(clientMessages.seq)),
  );

  const rows = await ctx.db
    .with(last, topics, answered)
    .select({
      clientId: last.clientId,
      username: clients.username,
      lastMessageAt: last.createdAt,
      lastMessageBody: last.body,
      direction: last.direction,
      // Кто ответил последним. В списке это отличает разобранный
      // разговор от того, до которого никто не дошёл: очередь общая, и
      // «отвечено» без имени не говорит, надо ли перечитывать.
      lastAuthorName: staff.displayName,
      topic: openTopic,
      handedToHumanAt: clients.handedToHumanAt,
    })
    .from(last)
    .innerJoin(clients, eq(clients.telegramUserId, last.clientId))
    .leftJoin(staff, eq(staff.id, last.authorStaffId))
    .leftJoin(topics, eq(topics.clientId, last.clientId))
    .leftJoin(answered, eq(answered.clientId, last.clientId))
    .where(topicCondition(filter.topic, openTopic))
    // Ждущие ответа сверху: это работа, а не история. Внутри — по
    // сквозному номеру, тому же, которым определяется последнее
    // сообщение: время двух записей в одну миллисекунду не разводит.
    .orderBy(sql`${last.direction} = 'incoming' desc`, desc(last.seq));

  return rows.map(({ direction, handedToHumanAt, ...row }) => ({
    ...row,
    isUnanswered: direction === 'incoming',
    handedToHuman: handedToHumanAt !== null,
  }));
}

/**
 * Условие отбора по теме. «Поддержка» — отсутствие темы, «оплата» — её
 * наличие: тем про оплату сегодня две, и обе они про одно.
 */
function topicCondition(
  filter: ConversationTopicFilter | undefined,
  column: SQL,
): SQL | undefined {
  if (filter === 'support') return isNull(column);
  if (filter === 'payment') return isNotNull(column);
  return undefined;
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
          isNull(clientMessages.staffNotifiedAt),
          /*
           * Поводов позвать человека два, и они исключают друг друга.
           *
           * Консьержа нет — повод тот же, что и был: начало череды, то
           * есть подтверждённое приёмом сообщение. Повторные до ответа
           * его не занимают и сотрудников не беспокоят.
           *
           * Консьерж есть — повод только один: он позвал человека сам.
           * Разобранное им сотрудникам не уходит, а `pending` ждёт: он
           * ещё думает, и звать менеджера к вопросу, на который вот-вот
           * ответят, значит звать его зря.
           */
          sql`case
            when ${clientMessages.conciergeOutcome} is null
              then ${clientMessages.acknowledgedAt} is not null
            else ${clientMessages.conciergeOutcome} = 'escalated'
          end`,
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
      recipients.map((recipient): Notification =>
        // Позвал консьерж — сотрудник должен прочитать причину раньше
        // самого вопроса: «что случилось» отвечается до того, как он
        // откроет переписку.
        message.escalationReason === null
          ? {
              kind: 'staff-client-message',
              to: recipient.telegramUserId,
              clientId: message.clientId,
              clientUsername: usernames.get(message.clientId) ?? null,
              preview: message.body ?? 'Изображение',
            }
          : {
              kind: 'staff-escalation',
              to: recipient.telegramUserId,
              clientId: message.clientId,
              clientUsername: usernames.get(message.clientId) ?? null,
              reason: message.escalationReason,
              preview: message.body ?? 'Изображение',
            },
      ),
    );
  });
}
