import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { clientMessages, requisiteAccessLog } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  ATTACHMENT_VIEW_WINDOW_MS,
  NEW_INQUIRY_AFTER_MINUTES,
  createCore,
  ForbiddenError,
  InvalidInputError,
  type Actor,
} from './index.js';
import { asClient, givenStaff } from './test-support.js';

/**
 * Переписка клиента с менеджером.
 *
 * Проверяется то, ради чего она заводится: сообщение клиента не
 * пропадает, ответ уходит тем ботом, которого клиент запускал, чужую
 * ленту прочитать нельзя, а подтверждение приёма не превращается в
 * автоответчик — оно приходит однажды на череду сообщений.
 */

const db = testDatabase();
const core = createCore({ db });

let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  await core.registerClient({ telegramUserId: 100n });
  manager = await givenStaff({ displayName: 'Пётр' });
});

afterAll(() => closeTestDatabase());

/** Состарить ленту: столько прошло с последнего сообщения клиента. */
async function agedFeed(minutes: number): Promise<void> {
  const shift = minutes * 60 * 1000;
  const rows = await db.select({ id: clientMessages.id, at: clientMessages.createdAt }).from(clientMessages);
  for (const row of rows) {
    await db
      .update(clientMessages)
      .set({ createdAt: new Date(row.at.getTime() - shift) })
      .where(eq(clientMessages.id, row.id));
  }
}

/** Состарить журнал: столько прошло с последнего просмотра. */
async function agedAccessLog(ms: number): Promise<void> {
  await db
    .update(requisiteAccessLog)
    .set({ accessedAt: new Date(Date.now() - ms) });
}

describe('сообщение клиента', () => {
  it('сохраняется входящим и появляется в переписке', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Когда придут деньги?' });

    const feed = await core.listConversation(manager, 100n);

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ direction: 'incoming', body: 'Когда придут деньги?' });
  });

  it('заводит клиента, если тот ни разу не открывал приложение', async () => {
    await core.receiveClientMessage({ telegramUserId: 777n, body: 'Здравствуйте' });

    expect(await core.listConversation(manager, 777n)).toHaveLength(1);
  });

  it('принимает вложение без текста: скриншот вместо объяснения', async () => {
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'AgACAgIAAxkBAAI', kind: 'photo' },
    });

    const [message] = await core.listConversation(manager, 100n);

    expect(message).toMatchObject({ attachment: { kind: 'photo', downloadable: true }, body: null });
  });

  it('не сохраняет пустое сообщение', async () => {
    await expect(
      core.receiveClientMessage({ telegramUserId: 100n, body: '   ' }),
    ).rejects.toThrow(InvalidInputError);
  });
});

describe('подтверждение приёма', () => {
  it('возвращается на первое сообщение', async () => {
    const { notifications } = await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Первый вопрос',
    });

    expect(notifications).toEqual([
      expect.objectContaining({ kind: 'client-message-received', to: 100n }),
    ]);
  });

  it('не повторяется на последующие, пока менеджер не ответил', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Первый' });

    const { notifications } = await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Второй',
    });

    expect(notifications).toEqual([]);
  });

  it('возвращается снова после ответа менеджера', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Первый' });
    await core.replyToClient(manager, { clientId: 100n, body: 'Отвечаю' });

    const { notifications } = await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Ещё вопрос',
    });

    expect(notifications).toHaveLength(1);
  });
});

describe('ответ менеджера', () => {
  it('сохраняется исходящим с указанием автора', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });

    await core.replyToClient(manager, { clientId: 100n, body: 'Ответ' });

    const feed = await core.listConversation(manager, 100n);
    expect(feed.at(-1)).toMatchObject({
      direction: 'outgoing',
      body: 'Ответ',
      authorName: 'Пётр',
    });
  });

  it('возвращает уведомление для доставки клиенту', async () => {
    const { notifications } = await core.replyToClient(manager, {
      clientId: 100n,
      body: 'Реквизиты выслал',
    });

    expect(notifications).toEqual([
      expect.objectContaining({ kind: 'manager-message', to: 100n, body: 'Реквизиты выслал' }),
    ]);
  });

  it('не отправляется пустым', async () => {
    await expect(
      core.replyToClient(manager, { clientId: 100n, body: '  ' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('не даётся тому, кто не сотрудник', async () => {
    await expect(
      core.replyToClient(asClient(100n), { clientId: 100n, body: 'Ответ' }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('чужая переписка', () => {
  it('не читается клиентом: пути чтения у него нет вовсе', async () => {
    // Клиент читает разговор в Telegram, а не в приложении, и операции
    // чтения ленты у него нет: единственная — для сотрудника, и она
    // отказывает всем остальным.
    await expect(core.listConversation(asClient(100n), 100n)).rejects.toThrow(ForbiddenError);
  });
});

describe('список обращений', () => {
  it('считает клиента неотвеченным, пока последнее сообщение входящее', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });

    const [conversation] = await core.listConversations(manager);

    expect(conversation).toMatchObject({ clientId: 100n, isUnanswered: true });
    expect(await core.countUnansweredConversations(manager)).toBe(1);
  });

  it('не называет ответившего, пока разговор ждёт ответа', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });

    expect((await core.listConversations(manager))[0]?.lastAuthorName).toBeNull();
  });

  it('перестаёт считать после ответа', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });
    await core.replyToClient(manager, { clientId: 100n, body: 'Ответ' });

    const [conversation] = await core.listConversations(manager);

    expect(conversation?.isUnanswered).toBe(false);
    expect(await core.countUnansweredConversations(manager)).toBe(0);
  });

  it('называет ответившего: очередь общая, и разобранное отличается от нетронутого', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });
    await core.replyToClient(manager, { clientId: 100n, body: 'Ответ' });

    expect((await core.listConversations(manager))[0]?.lastAuthorName).toBe('Пётр');
  });

  it('считает снова, если клиент написал после ответа', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Вопрос' });
    await core.replyToClient(manager, { clientId: 100n, body: 'Ответ' });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Ещё' });

    expect(await core.countUnansweredConversations(manager)).toBe(1);
  });

  it('разводит сообщения одного мгновения по сквозному номеру', async () => {
    // Две записи, вставленные одной транзакцией, получают одно и то же
    // время создания: `now()` в Postgres — время начала транзакции. По
    // нему «последнее сообщение» неопределимо, и ответ на вопрос «ждёт
    // ли клиент» зависел бы от того, как лягут строки.
    await db.transaction(async (tx) => {
      await tx.insert(clientMessages).values({
        clientId: 100n,
        direction: 'incoming',
        body: 'Вопрос',
      });
      await tx.insert(clientMessages).values({
        clientId: 100n,
        direction: 'outgoing',
        body: 'Ответ',
        authorStaffId: manager.staffId,
      });
    });

    expect(await core.countUnansweredConversations(manager)).toBe(0);
    expect((await core.listConversations(manager))[0]?.isUnanswered).toBe(false);
  });

  it('пуст, пока никто не писал', async () => {
    expect(await core.listConversations(manager)).toEqual([]);
    expect(await core.countUnansweredConversations(manager)).toBe(0);
  });
});

// Рассылка обращений сотрудникам проверяется в `staff-alerts.test.ts`:
// поводов позвать менеджера несколько, забирает их одна операция, и
// правила у неё общие для обращения и для заявки.

describe('вложение', () => {
  it('открывается менеджеру и оставляет след в журнале', async () => {
    const admin = await givenStaff({ role: 'admin' });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'AgACAgIAAxkBAAI', kind: 'photo' },
    });
    const [message] = await core.listConversation(manager, 100n);

    // Тем же путём, каким идёт маршрут: описание, затем запись о просмотре.
    const revealed = await core.describeMessageAttachment(manager, message!.id);
    await core.logMessageAttachmentView(manager, message!.id);

    expect(revealed).toMatchObject({ fileId: 'AgACAgIAAxkBAAI', kind: 'photo' });
    const log = await core.listRequisiteAccessLog(admin);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ clientId: 100n, messageId: message!.id });
  });

  it('описание файла само по себе следа не оставляет: файла ещё не видели', async () => {
    // Между «дай описание» и «отдай файл» стоит поход к Telegram, и
    // файла у него может уже не быть. Запись о просмотре ставит тот,
    // кто файл отдал.
    const admin = await givenStaff({ role: 'admin' });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'AgACAgIAAxkBAAI', kind: 'photo' },
    });
    const [message] = await core.listConversation(manager, 100n);

    await core.describeMessageAttachment(manager, message!.id);

    expect(await core.listRequisiteAccessLog(admin)).toEqual([]);
  });

  it('плеер, дочитывающий файл кусками, не плодит записей в журнале', async () => {
    // Safari просит голосовое по частям заголовком Range, и каждая
    // часть проходит через операцию. Журнал отвечает на вопрос «кто и
    // что смотрел», а не «сколько кусков забрал».
    const admin = await givenStaff({ role: 'admin' });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'AwACAgIAAxkBAAID', kind: 'voice', mime: 'audio/ogg', size: 61_000 },
    });
    const [message] = await core.listConversation(manager, 100n);

    await core.logMessageAttachmentView(manager, message!.id);
    await core.logMessageAttachmentView(manager, message!.id);
    await core.logMessageAttachmentView(manager, message!.id);

    expect(await core.listRequisiteAccessLog(admin)).toHaveLength(1);
  });

  it('открытое заново спустя время — новый просмотр', async () => {
    const admin = await givenStaff({ role: 'admin' });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'AgACAgIAAxkBAAI', kind: 'photo' },
    });
    const [message] = await core.listConversation(manager, 100n);
    await core.logMessageAttachmentView(manager, message!.id);
    await agedAccessLog(ATTACHMENT_VIEW_WINDOW_MS + 60_000);

    await core.logMessageAttachmentView(manager, message!.id);

    expect(await core.listRequisiteAccessLog(admin)).toHaveLength(2);
  });

  it('второй сотрудник записывается своим просмотром', async () => {
    const admin = await givenStaff({ role: 'admin', telegramUserId: 907n });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'AgACAgIAAxkBAAI', kind: 'photo' },
    });
    const [message] = await core.listConversation(manager, 100n);

    await core.logMessageAttachmentView(manager, message!.id);
    await core.logMessageAttachmentView(admin, message!.id);

    expect(await core.listRequisiteAccessLog(admin)).toHaveLength(2);
  });

  it('не оставляет следа, пока его не открыли', async () => {
    const admin = await givenStaff({ role: 'admin' });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'AgACAgIAAxkBAAI', kind: 'photo' },
    });

    expect(await core.listRequisiteAccessLog(admin)).toEqual([]);
  });

  it('не открывается у сообщения без файла', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Просто текст' });
    const [message] = await core.listConversation(manager, 100n);

    await expect(core.describeMessageAttachment(manager, message!.id)).rejects.toThrow(
      /не приложен/i,
    );
  });
});

/*
 * Файл, а не только фото: чек уходит PDF, скриншот — «как файл», и до
 * 4 сентября 2026 такое сообщение бот терял молча. Менеджеру файл
 * описан именем, типом и размером; предел скачивания у Telegram —
 * 20 МБ, и файл сверх него называется недоступным сразу, а не битой
 * ссылкой при открытии.
 */
describe('файл клиента', () => {
  const receipt = {
    fileId: 'BQACAgIAAxkBAAIC',
    kind: 'document' as const,
    mime: 'application/pdf',
    name: 'чек.pdf',
    size: 245_760,
  };

  it('описан менеджеру именем, типом и размером', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'вот чек', attachment: receipt });
    const [message] = await core.listConversation(manager, 100n);

    expect(message!.attachment).toEqual({
      kind: 'document',
      mime: 'application/pdf',
      name: 'чек.pdf',
      size: 245_760,
      downloadable: true,
    });
    expect(await core.describeMessageAttachment(manager, message!.id)).toEqual(receipt);
  });

  it('больше предела Telegram: клиенту говорится сразу, менеджеру недоступен', async () => {
    const admin = await givenStaff({ role: 'admin' });

    const { notifications } = await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'BAACAgIAAxkBAAID', kind: 'video', mime: 'video/mp4', size: 25 * 1024 * 1024 },
    });

    expect(notifications.map((one) => one.kind)).toEqual([
      'client-attachment-too-large',
      'client-message-received',
    ]);
    const [message] = await core.listConversation(manager, 100n);
    expect(message!.attachment).toMatchObject({ kind: 'video', downloadable: false });
    await expect(core.describeMessageAttachment(manager, message!.id)).rejects.toThrow(/предел/i);
    // Открытия не было — и следа в журнале нет.
    expect(await core.listRequisiteAccessLog(admin)).toEqual([]);
  });

  it('в списке обращений вложение без подписи названо словом', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, attachment: receipt });

    const [conversation] = await core.listConversations(manager);

    expect(conversation).toMatchObject({
      lastMessageBody: null,
      lastAttachment: 'Файл чек.pdf (240 КБ)',
    });
  });

  it('в уведомлении сотруднику файл назван рядом со словами клиента', async () => {
    await givenStaff({ displayName: 'Анна', telegramUserId: 905n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'вот чек', attachment: receipt });

    const [alert] = await core.takeStaffAlerts(new Date());

    expect(alert).toMatchObject({
      kind: 'staff-client-message',
      preview: 'вот чек',
      attachment: 'файл чек.pdf (240 КБ)',
    });
  });
});

/*
 * Подтверждение приёма одно на череду сообщений — чтобы человек,
 * пишущий мысль тремя сообщениями подряд, не получил три одинаковых
 * ответа. Но у череды есть срок: клиент, вернувшийся через восемь
 * часов, пишет не продолжение, а новое обращение, и молчание в ответ
 * читается им как сломанный бот. 4 сентября 2026 так и вышло: утреннее
 * сообщение осталось без ответа менеджера, и присланный днём чек не
 * получил ни ответа клиенту, ни уведомления сотруднику.
 */
describe('новое обращение после паузы', () => {
  it('дописка следом подтверждения не повторяет', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Здравствуйте' });

    const { notifications } = await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Точнее, вопрос такой',
    });

    expect(notifications).toEqual([]);
  });

  it('после долгого молчания клиента подтверждение приходит снова', async () => {
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Здравствуйте' });
    await agedFeed(NEW_INQUIRY_AFTER_MINUTES + 5);

    const { notifications } = await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Я вернулся, вот чек',
    });

    expect(notifications).toEqual([
      { kind: 'client-message-received', to: 100n },
    ]);
  });

  it('и сотрудникам о нём сообщают заново', async () => {
    await givenStaff({ displayName: 'Анна', telegramUserId: 908n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Здравствуйте' });
    await core.takeStaffAlerts(new Date());
    await agedFeed(NEW_INQUIRY_AFTER_MINUTES + 5);
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Я вернулся' });

    // Среди прочего в этот прогон уходит и напоминание о забытом утреннем
    // сообщении: состарив ленту, тест состарил и его.
    const alerts = (await core.takeStaffAlerts(new Date())).filter(
      (one) => one.kind === 'staff-client-message',
    );

    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ kind: 'staff-client-message', preview: 'Я вернулся' });
  });
});

/*
 * Файл — всегда повод позвать человека, даже посреди начатого
 * разговора: чек это событие про деньги, и менеджер, не узнавший о нём,
 * увидит его, только если сам откроет панель.
 */
describe('файл зовёт сотрудников', () => {
  it('даже когда подтверждение в этой череде уже уходило', async () => {
    await givenStaff({ displayName: 'Анна', telegramUserId: 909n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Здравствуйте' });
    await core.takeStaffAlerts(new Date());

    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'BQACAgIAAxkBAAIC', kind: 'document', name: 'чек.pdf', size: 245_760 },
    });
    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts).toHaveLength(2);
    // Подписи у файла нет, и описание занимает место слов клиента.
    expect(alerts[0]).toMatchObject({
      kind: 'staff-client-message',
      preview: 'Файл чек.pdf (240 КБ)',
    });
  });

  it('но второй раз о том же файле не напоминает', async () => {
    await givenStaff({ displayName: 'Анна', telegramUserId: 910n });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachment: { fileId: 'AgACAgIAAxkBAAI', kind: 'photo' },
    });

    await core.takeStaffAlerts(new Date());

    expect(await core.takeStaffAlerts(new Date())).toEqual([]);
  });
});
