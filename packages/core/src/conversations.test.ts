import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clientMessages } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, ForbiddenError, InvalidInputError, type Actor } from './index.js';
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

    const revealed = await core.revealMessageAttachment(manager, message!.id);

    expect(revealed).toMatchObject({ fileId: 'AgACAgIAAxkBAAI', kind: 'photo' });
    const log = await core.listRequisiteAccessLog(admin);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ clientId: 100n, messageId: message!.id });
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

    await expect(core.revealMessageAttachment(manager, message!.id)).rejects.toThrow(
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
    expect(await core.revealMessageAttachment(manager, message!.id)).toEqual(receipt);
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
    await expect(core.revealMessageAttachment(manager, message!.id)).rejects.toThrow(/предел/i);
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
      attachment: 'Файл чек.pdf (240 КБ)',
    });
  });
});
