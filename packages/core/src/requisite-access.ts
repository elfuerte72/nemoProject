import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { open } from '@nemo/crypto';
import {
  clientMessages,
  clientRequisites,
  exchangeRequests,
  requisiteAccessLog,
  staff,
} from '@nemo/db';
import { parsePromptPay, type PromptPayIdType, type RequisiteKind } from '@nemo/types';
import { requireAdmin, requireStaff, type Actor } from './actor.js';
import { isDownloadable, type AttachmentKind } from './attachments.js';
import { requirePrivateKey, type CoreConfig, type Executor } from './context.js';
import { ForbiddenError, NotFoundError } from './errors.js';
import { describeRequisites } from './requisites.js';

/**
 * Чтение полного номера карты менеджером и журнал таких чтений.
 *
 * Расшифровать реквизиты может только админ-панель: приватного ключа в
 * клиентском деплое нет физически (docs/adr/0002). Но одного этого мало
 * — сотрудник с доступом к админке видит чужие номера карт, и должно
 * оставаться, кто и когда их видел.
 *
 * Запись в журнал идёт в той же транзакции, что и чтение, и вызывающая
 * сторона не может её пропустить: расшифрованный номер возвращается
 * только после того, как строка журнала записана. Отдельная операция
 * «записать в журнал», которую можно не позвать, держалась бы на памяти
 * того, кто пишет следующий экран.
 *
 * Журнал только на чтение и только администратору: правки в нём не
 * предусмотрены, а менеджер — тот, за кем он ведётся.
 */

export interface RevealedRequisites {
  /** Способ получения. Менеджер читает его словами, а не по заполненным полям. */
  readonly kind: RequisiteKind;
  readonly bankName: string | null;
  readonly phone: string | null;
  /** Полный номер карты. Показывается менеджеру и нигде не хранится. */
  readonly cardNumber: string | null;
  readonly cardLast4: string | null;
  /** Сеть кошелька. Ошибка сети необратима, поэтому она идёт рядом с адресом. */
  readonly network: string | null;
  readonly address: string | null;
  /** Имя получателя — менеджер сверяет его перед отправкой. */
  readonly holderName: string | null;
  /** Полный номер тайского счёта — цифрами, без разделителей. */
  readonly accountNumber: string | null;
  /**
   * Содержимое QR строкой — PromptPay или ссылка Alipay. Панель рисует
   * по ней QR заново: менеджер сканирует его вторым устройством или
   * сохраняет в альбом.
   */
  readonly qr: string | null;
  /** Что внутри PromptPay-QR: тип и сам идентификатор — набрать руками. */
  readonly promptpayIdType: PromptPayIdType | null;
  readonly promptpayId: string | null;
  readonly alipayAccount: string | null;
}

export interface RequisiteAccessEntry {
  readonly id: string;
  readonly staffId: string;
  readonly staffName: string;
  readonly clientId: bigint;
  readonly exchangeRequestId: string | null;
  readonly withdrawalRequestId: string | null;
  /** Вложение из переписки, если открывали его. */
  readonly messageId: string | null;
  /** Что именно открывали. Пусто у реквизитов заявки на вывод: записи в справочнике нет. */
  readonly requisiteKind: RequisiteKind | null;
  readonly requisiteHint: string | null;
  readonly accessedAt: Date;
}

/**
 * Записать обращение к реквизиту. Вызывается изнутри той же транзакции,
 * в которой реквизит расшифровывается: вернуть открытое значение, не
 * оставив следа, вызывающая сторона не может.
 */
export async function logRequisiteAccess(
  executor: Executor,
  entry: {
    staffId: string;
    clientId: bigint;
    requisitesId?: string;
    exchangeRequestId?: string;
    withdrawalRequestId?: string;
    messageId?: string;
  },
): Promise<void> {
  await executor.insert(requisiteAccessLog).values({
    staffId: entry.staffId,
    clientId: entry.clientId,
    requisitesId: entry.requisitesId ?? null,
    exchangeRequestId: entry.exchangeRequestId ?? null,
    withdrawalRequestId: entry.withdrawalRequestId ?? null,
    messageId: entry.messageId ?? null,
  });
}

/** Окно, внутри которого повторное обращение к тому же файлу — тот же просмотр. */
export const ATTACHMENT_VIEW_WINDOW_MS = 5 * 60 * 1000;

/**
 * Вложение, присланное клиентом, — менеджеру, который его открывает.
 *
 * Возвращается идентификатор файла у Telegram и его описание: сам файл
 * сервис не хранит, панель подтягивает его по идентификатору клиентским
 * токеном, а по описанию решает, под каким именем и типом отдать.
 * Обращение попадает в тот же журнал, что и чтение номера карты, и в
 * той же транзакции: на скриншоте перевода и в чеке видно и счёт, и
 * имя, и след от просмотра нужен по той же причине.
 *
 * Без открытия файла записи не появляется: операцию зовёт ровно тот
 * маршрут, который отдаёт файл. Файл сверх предела Telegram не
 * открывается и в журнал не пишется — просмотра не было.
 *
 * Один просмотр — одна запись, даже когда файл забирают кусками: плеер
 * просит голосовое заголовком Range и приходит за ним по три-пять раз, а
 * журнал отвечает на вопрос «кто и что смотрел», и пятикратная запись
 * одного прослушивания этот ответ портит. Поэтому повтор того же
 * сотрудника по тому же сообщению в пределах окна следа не оставляет.
 * Проверка идёт до вставки, а не вместо неё: первое обращение
 * записывается всегда, и обойти журнал, попросив файл кусками, нельзя.
 */

export interface RevealedAttachment {
  readonly fileId: string;
  readonly kind: AttachmentKind;
  readonly mime: string | null;
  readonly name: string | null;
  readonly size: number | null;
}

export async function revealMessageAttachment(
  ctx: CoreConfig,
  actor: Actor,
  messageId: string,
): Promise<RevealedAttachment> {
  const staffActor = requireStaff(actor);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        clientId: clientMessages.clientId,
        attachmentFileId: clientMessages.attachmentFileId,
        attachmentKind: clientMessages.attachmentKind,
        attachmentMime: clientMessages.attachmentMime,
        attachmentName: clientMessages.attachmentName,
        attachmentSize: clientMessages.attachmentSize,
      })
      .from(clientMessages)
      .where(eq(clientMessages.id, messageId))
      .limit(1);

    if (!row) {
      throw new NotFoundError('Сообщение не найдено');
    }
    if (!row.attachmentFileId || !row.attachmentKind) {
      throw new NotFoundError('К сообщению не приложен файл');
    }
    if (!isDownloadable(row.attachmentSize)) {
      throw new NotFoundError('Файл больше предела Telegram, и скачать его нельзя');
    }

    /*
     * Два куска, пришедших одновременно, оба могут не найти записи и оба
     * её вставить: блокировки тут нет намеренно — цена ошибки лишняя
     * строка в журнале, а цена блокировки — очередь из плееров на каждом
     * куске файла.
     */
    const [recent] = await tx
      .select({ id: requisiteAccessLog.id })
      .from(requisiteAccessLog)
      .where(
        and(
          eq(requisiteAccessLog.staffId, staffActor.staffId),
          eq(requisiteAccessLog.messageId, messageId),
          gte(requisiteAccessLog.accessedAt, new Date(Date.now() - ATTACHMENT_VIEW_WINDOW_MS)),
        ),
      )
      .limit(1);

    if (!recent) {
      await logRequisiteAccess(tx, {
        staffId: staffActor.staffId,
        clientId: row.clientId,
        messageId,
      });
    }

    return {
      fileId: row.attachmentFileId,
      kind: row.attachmentKind,
      mime: row.attachmentMime,
      name: row.attachmentName,
      size: row.attachmentSize,
    };
  });
}

/**
 * Реквизиты клиента по заявке на обмен, которую ведёт менеджер.
 *
 * Заявка обязательна, и она должна быть взята именно этим менеджером:
 * «в момент работы с его заявкой» — это после того, как он её взял. У
 * невзятой заявки владельца нет, и открытый по ней номер карты означал
 * бы, что чужие реквизиты доступны всей смене просто по ссылке.
 */
export async function revealRequisites(
  ctx: CoreConfig,
  actor: Actor,
  exchangeRequestId: string,
): Promise<RevealedRequisites> {
  const staff = requireStaff(actor);
  const privateKey = requirePrivateKey(ctx);

  return ctx.db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(exchangeRequests)
      .where(eq(exchangeRequests.id, exchangeRequestId))
      .limit(1);
    if (!request) {
      throw new NotFoundError('Заявка на обмен не найдена');
    }
    if (request.assignedManagerId !== staff.staffId) {
      throw new ForbiddenError(
        'Реквизиты открываются менеджеру, взявшему заявку на обмен в работу',
      );
    }
    const staffId = staff.staffId;

    if (!request.requisitesId) {
      throw new NotFoundError('К заявке на обмен не приложены реквизиты');
    }

    const [row] = await tx
      .select()
      .from(clientRequisites)
      .where(eq(clientRequisites.id, request.requisitesId))
      .limit(1);
    if (!row) {
      throw new NotFoundError('Реквизиты не найдены');
    }

    await logRequisiteAccess(tx, {
      staffId,
      clientId: row.clientId,
      requisitesId: row.id,
      exchangeRequestId: request.id,
    });

    const qr = row.qrSealed ? open(privateKey, row.qrSealed) : null;
    // Идентификатор разбирается из расшифрованной строки заново, а не
    // хранится рядом: он и есть содержимое QR, и вторая копия ничего не
    // добавила бы, кроме возможности разойтись.
    const promptpay = row.kind === 'promptpay' && qr ? parsePromptPay(qr) : null;

    return {
      kind: row.kind,
      bankName: row.bankName,
      phone: row.phone,
      cardNumber: row.cardSealed ? open(privateKey, row.cardSealed) : null,
      cardLast4: row.cardLast4,
      network: row.network,
      address: row.addressSealed ? open(privateKey, row.addressSealed) : null,
      holderName: row.holderName,
      accountNumber: row.accountSealed ? open(privateKey, row.accountSealed) : null,
      qr,
      promptpayIdType: row.promptpayIdType,
      promptpayId: promptpay?.ok ? promptpay.id : null,
      alipayAccount: row.alipayAccount,
    };
  });
}

export interface RequisiteAccessFilter {
  readonly staffId?: string | undefined;
  readonly clientId?: bigint | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export async function listRequisiteAccessLog(
  ctx: CoreConfig,
  actor: Actor,
  filter: RequisiteAccessFilter = {},
): Promise<readonly RequisiteAccessEntry[]> {
  requireAdmin(actor);

  const conditions: SQL[] = [];
  if (filter.staffId) conditions.push(eq(requisiteAccessLog.staffId, filter.staffId));
  if (filter.clientId !== undefined) {
    conditions.push(eq(requisiteAccessLog.clientId, filter.clientId));
  }
  if (filter.from) conditions.push(gte(requisiteAccessLog.accessedAt, filter.from));
  if (filter.to) conditions.push(lte(requisiteAccessLog.accessedAt, filter.to));

  // С сотрудником — обязательно, с реквизитом — по возможности: реквизит
  // бывает двух родов, и обязательное соединение с сохранённой записью
  // выкинуло бы из журнала обращения к реквизитам вывода.
  const rows = await ctx.db
    .select({
      id: requisiteAccessLog.id,
      staffId: requisiteAccessLog.staffId,
      staffName: staff.displayName,
      clientId: requisiteAccessLog.clientId,
      exchangeRequestId: requisiteAccessLog.exchangeRequestId,
      withdrawalRequestId: requisiteAccessLog.withdrawalRequestId,
      messageId: requisiteAccessLog.messageId,
      accessedAt: requisiteAccessLog.accessedAt,
      requisites: clientRequisites,
    })
    .from(requisiteAccessLog)
    .innerJoin(staff, eq(staff.id, requisiteAccessLog.staffId))
    .leftJoin(clientRequisites, eq(clientRequisites.id, requisiteAccessLog.requisitesId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(requisiteAccessLog.accessedAt));

  // Что именно открывали — той же подписью, по которой запись называется
  // клиенту в приложении: администратор и клиент говорят про один
  // реквизит и должны узнавать его одинаково.
  return rows.map(({ requisites, ...entry }) => ({
    ...entry,
    requisiteKind: requisites?.kind ?? null,
    requisiteHint: requisites === null ? null : describeRequisites(requisites),
  }));
}
