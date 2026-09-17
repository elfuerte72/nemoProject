import { count, desc, eq } from 'drizzle-orm';
import { broadcasts, clients } from '@nemo/db';
import { requireAdmin, requireClient, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';

/**
 * Согласие на рассылку и ручные рассылки.
 *
 * Сообщения уходят только тем, кто согласился, и согласие снимается
 * немедленно: отписка, действующая «со следующей рассылки», — это ещё
 * одно письмо человеку, который попросил их прекратить.
 *
 * Само отправление — работа приложения: список получателей операция
 * отдаёт, доставку выполняет `@nemo/telegram`, результат возвращается
 * сюда. Разделение вынужденное — ядро не ходит в сеть, — но и полезное:
 * ограничение Telegram на частоту сообщений живёт там, где сообщения
 * отправляются, а не там, где считаются.
 */

export interface BroadcastView {
  readonly id: string;
  readonly body: string;
  readonly authorStaffId: string;
  /** Скольким согласившимся предназначалась рассылка. */
  readonly recipients: number;
  readonly delivered: number;
  readonly failed: number;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
}

export interface StartedBroadcast {
  readonly broadcast: BroadcastView;
  /**
   * Кому отправлять. Только клиенты с действующим согласием. У повтора
   * пусто: этот черновик уже отправляется или отправлен.
   */
  readonly recipients: readonly bigint[];
  /** Черновик с этим ключом уже заводил рассылку — отдана она же. */
  readonly repeated: boolean;
}

export interface StartBroadcastInput {
  readonly body: string;
  /**
   * Ключ повтора, один на черновик. Форма выдаёт новый, когда текст
   * меняется, и тот же — на повторное нажатие после оборванного запроса.
   */
  readonly idempotencyKey: string;
}

type BroadcastRow = typeof broadcasts.$inferSelect;

function toView(row: BroadcastRow): BroadcastView {
  return {
    id: row.id,
    body: row.body,
    authorStaffId: row.authorStaffId,
    recipients: row.recipients,
    delivered: row.delivered,
    failed: row.failed,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

/**
 * Согласие на рассылку. Клиент отвечает на вопрос при первом входе и
 * может передумать в любой момент.
 *
 * Отметка о том, что вопрос задан, ставится вместе с ответом: без неё
 * «отказался» и «не спрашивали» неразличимы, и клиент, закрывший
 * приложение до ответа, не увидел бы вопроса больше никогда.
 */
export async function setMarketingConsent(
  ctx: CoreConfig,
  actor: Actor,
  consent: boolean,
): Promise<{ marketingConsent: boolean; asked: boolean }> {
  const clientId = requireClient(actor);
  const [row] = await ctx.db
    .update(clients)
    .set({ marketingConsent: consent, marketingConsentAskedAt: new Date() })
    .where(eq(clients.telegramUserId, clientId))
    .returning({
      marketingConsent: clients.marketingConsent,
      askedAt: clients.marketingConsentAskedAt,
    });

  if (!row) {
    throw new NotFoundError('Клиент не найден');
  }
  return { marketingConsent: row.marketingConsent, asked: row.askedAt !== null };
}

/**
 * Скольким уйдёт рассылка, если отправить её сейчас.
 *
 * Называется в подтверждении до отправки: «разослать» без числа не
 * говорит, что нажатие дойдёт до тысяч людей и отозвать его нельзя.
 * Число может разойтись с итоговым на тех, кто ответил на вопрос о
 * согласии между подтверждением и отправкой, — список получателей всё
 * равно читает `startBroadcast`.
 */
export async function countBroadcastAudience(ctx: CoreConfig, actor: Actor): Promise<number> {
  requireAdmin(actor);
  const [row] = await ctx.db
    .select({ value: count() })
    .from(clients)
    .where(eq(clients.marketingConsent, true));
  return row?.value ?? 0;
}

/**
 * Составить рассылку и получить список получателей.
 *
 * Список читается здесь и один раз: отписавшийся во время отправки уже
 * не должен получить сообщение, но и пересчитывать список на каждом
 * шаге доставки незачем — рассылка идёт минуты, а не дни.
 *
 * Весь список сразу, без страниц: клиентов сервиса — тысячи, и
 * страничная выдача усложнила бы отправку ради экономии, которой на
 * этом объёме не видно. Когда их станет на порядок больше, поменяется
 * эта операция, а не каждый вызывающий её экран.
 */
export async function startBroadcast(
  ctx: CoreConfig,
  actor: Actor,
  input: StartBroadcastInput,
): Promise<StartedBroadcast> {
  const admin = requireAdmin(actor);
  const body = input.body.trim();
  if (!body) {
    throw new InvalidInputError('Рассылка без текста никому ничего не сообщит');
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 100) {
    // Без ключа оборванный запрос нечем отличить от новой рассылки, и
    // повтор разослал бы текст второй раз: правило держит операция, а
    // не форма.
    throw new InvalidInputError('Рассылка не отправлена: обновите страницу и отправьте снова');
  }

  return ctx.db.transaction(async (tx) => {
    const consenting = await tx
      .select({ telegramUserId: clients.telegramUserId })
      .from(clients)
      .where(eq(clients.marketingConsent, true));

    /*
     * Повтор черновика отдаёт уже заведённую рассылку, а не заводит
     * вторую. Вставкой с `on conflict do nothing`, а не чтением перед
     * ней: два повтора разом прочли бы пустоту оба. Нарушение
     * уникальности, пойманное как ошибка, прервало бы транзакцию, и
     * дочитать первую рассылку было бы уже нечем.
     */
    const [row] = await tx
      .insert(broadcasts)
      .values({
        authorStaffId: admin.staffId,
        body,
        recipients: consenting.length,
        idempotencyKey,
      })
      .onConflictDoNothing({ target: broadcasts.idempotencyKey })
      .returning();

    if (row) {
      return {
        broadcast: toView(row),
        recipients: consenting.map((one) => one.telegramUserId),
        repeated: false,
      };
    }

    const [earlier] = await tx
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.idempotencyKey, idempotencyKey))
      .limit(1);
    if (!earlier) {
      throw new ConflictError('Рассылка уже отправляется: обновите страницу');
    }
    // Тот же ключ с другим текстом — не повтор, а сбой формы: отдать
    // первую рассылку значило бы сказать «ушло» о тексте, который не
    // уходил, а разослать — нарушить обещание ключа.
    if (earlier.body !== body) {
      throw new ConflictError(
        'Этот черновик уже разослан с другим текстом. Обновите страницу и отправьте новый текст заново',
      );
    }
    return { broadcast: toView(earlier), recipients: [], repeated: true };
  });
}

export interface BroadcastProgress {
  readonly delivered: number;
  readonly failed: number;
}

async function saveProgress(
  ctx: CoreConfig,
  broadcastId: string,
  progress: BroadcastProgress,
  finished: boolean,
): Promise<BroadcastView> {
  const [row] = await ctx.db
    .update(broadcasts)
    .set({
      delivered: Math.max(0, Math.trunc(progress.delivered)),
      failed: Math.max(0, Math.trunc(progress.failed)),
      ...(finished ? { finishedAt: new Date() } : {}),
    })
    .where(eq(broadcasts.id, broadcastId))
    .returning();

  if (!row) {
    throw new NotFoundError('Рассылка не найдена');
  }
  return toView(row);
}

/**
 * Отметить, сколько разослано на текущий момент.
 *
 * Счётчики сохраняются по ходу отправки, а не только в конце: рассылка
 * по большому списку идёт минутами, и запрос, который её запустил,
 * может оборваться по таймауту раньше, чем она закончится. Тогда
 * администратор увидит, сколько успело уйти, — вместо нулей и
 * незавершённой рассылки, о которой ничего не известно.
 */
export async function recordBroadcastProgress(
  ctx: CoreConfig,
  actor: Actor,
  broadcastId: string,
  progress: BroadcastProgress,
): Promise<BroadcastView> {
  requireAdmin(actor);
  return saveProgress(ctx, broadcastId, progress, false);
}

/**
 * Записать итог отправки: сколько дошло, сколько нет.
 *
 * Хранится, а не только показывается: вопрос «дошло ли до людей письмо
 * на прошлой неделе» возникает тогда, когда экран отправки давно
 * закрыт.
 */
export async function finishBroadcast(
  ctx: CoreConfig,
  actor: Actor,
  broadcastId: string,
  result: BroadcastProgress,
): Promise<BroadcastView> {
  requireAdmin(actor);
  return saveProgress(ctx, broadcastId, result, true);
}

export async function listBroadcasts(
  ctx: CoreConfig,
  actor: Actor,
  limit = 50,
): Promise<readonly BroadcastView[]> {
  requireAdmin(actor);
  const rows = await ctx.db
    .select()
    .from(broadcasts)
    .orderBy(desc(broadcasts.createdAt))
    .limit(limit);
  return rows.map(toView);
}
