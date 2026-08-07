import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { clientMessages, clients } from '@nemo/db';
import { requireStaff, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { conciergeFacts } from './concierge-facts.js';
import { replyComplaints } from './concierge-guard.js';
import type { ConciergeAnswer, ConciergeSource, ConciergeTurn } from './concierge-source.js';
import { escalationTrigger } from './concierge-triggers.js';
import {
  CONCIERGE_GREETING,
  CONCIERGE_HANDOVER,
  CONCIERGE_INSTRUCTIONS,
} from './concierge-voice.js';
import { NotFoundError } from './errors.js';
import type { Notification } from './notifications.js';
import { readServiceSettings } from './settings.js';

/**
 * Консьерж: первая линия разговора с клиентом.
 *
 * Отвечает сразу и на всё, кроме того, что должен слышать человек.
 * Человека зовут три вещи: слово из списка (до модели и мимо неё),
 * просьба самой модели и всякий отказ — исчерпанный предел, молчащий
 * провайдер, ответ, не прошедший заставу. Разница между ними — забота
 * сервиса; клиенту во всех случаях говорится одно и то же.
 *
 * Позвав человека, консьерж замолкает до тех пор, пока менеджер не
 * вернёт ему голос кнопкой. Два голоса в одном чате — худшее из
 * возможного: клиент, которому менеджер назвал цену, не должен получить
 * следом бота с пересказом справки.
 *
 * Сколько ответов даётся клиенту и сервису за сутки — настройка, а не
 * константа: это счёт у провайдера, а константы, определяющие деньги, в
 * коде не остаются.
 */

export interface AnswerAsConciergeInput {
  readonly telegramUserId: bigint;
}

export interface AnswerAsConciergeResult {
  readonly notifications: readonly Notification[];
  /**
   * Позвали человека. Адаптеру это нужно, чтобы разбудить панель: повод
   * для сотрудников появляется только здесь, а на обычный ответ будить
   * её незачем — она о нём и не узнает.
   */
  readonly handedToHuman: boolean;
}

/**
 * Сколько сообщений разговора уходит в запрос.
 *
 * Двадцать — это примерно два захода в поддержку с ответами. Лента
 * целиком не нужна и вредна: разговор полугодовой давности разбавляет
 * сегодняшний вопрос, а платят за него каждый раз заново.
 */
const TURNS_IN_REQUEST = 20;

/**
 * Через сколько брошенное сообщение считается брошенным.
 *
 * Больше срока запроса к провайдеру с запасом: иначе опрос перехватывал
 * бы сообщение у живого фона, который просто ещё не дождался ответа, — и
 * клиент получал бы два ответа на один вопрос.
 */
const STALE_CLAIM_MS = 5 * 60 * 1000;

/**
 * Что консьерж вправе взять: никем не занятое либо брошенное.
 *
 * Одно условие на оба места, где оно нужно, — занятие и страховка.
 * Разойдясь, они дали бы либо вечно висящее сообщение, либо два ответа
 * на один вопрос.
 */
function claimable(at: Date): SQL {
  return or(
    eq(clientMessages.conciergeOutcome, 'pending'),
    and(
      eq(clientMessages.conciergeOutcome, 'answering'),
      lt(clientMessages.createdAt, new Date(at.getTime() - STALE_CLAIM_MS)),
    ),
  )!;
}

/** Работает ли консьерж в этом деплое. */
export function hasConcierge(ctx: CoreConfig): boolean {
  return ctx.concierge !== undefined;
}

/**
 * Возьмётся ли консьерж за следующее сообщение этого клиента.
 *
 * Спрашивается при приёме сообщения: от ответа зависит, уходит ли
 * клиенту подтверждение приёма и уходит ли повод сотрудникам. Ответ
 * читается из строки клиента, которая на этот момент уже заблокирована.
 */
export function conciergeTakesOver(
  ctx: CoreConfig,
  client: { handedToHumanAt: Date | null },
): boolean {
  return hasConcierge(ctx) && client.handedToHumanAt === null;
}

/**
 * Ответить клиенту от лица консьержа.
 *
 * Отдельной операцией, а не частью приёма сообщения: провайдер думает
 * секунды, а Telegram ждёт ответа на вебхук. Приём сохраняет сообщение и
 * возвращается сразу, а это вызывается следом — в фоне или опросом, если
 * фоновая попытка не дошла.
 */
export async function answerAsConcierge(
  ctx: CoreConfig,
  input: AnswerAsConciergeInput,
): Promise<AnswerAsConciergeResult> {
  const source = ctx.concierge;
  if (!source) return { notifications: [], handedToHuman: false };

  const pending = await claimPending(ctx, input.telegramUserId);
  if (pending === null) return { notifications: [], handedToHuman: false };

  const outcome = await decide(ctx, source, pending);

  return settle(ctx, pending, outcome);
}

/** Сообщение, за которое консьерж взялся, и разговор вокруг него. */
interface Pending {
  readonly clientId: bigint;
  readonly messageId: string;
  readonly body: string | null;
  readonly hasAttachment: boolean;
  /** Первый ответ в разговоре: только в нём консьерж представляется. */
  readonly isFirstAnswer: boolean;
  readonly conversation: readonly ConciergeTurn[];
}

/** Чем кончилось: текст клиенту либо причина позвать человека. */
type Outcome = { readonly reply: string } | { readonly escalateBecause: string };

/**
 * Занять сообщение, на которое надо ответить.
 *
 * Занимается условным изменением: два наложившихся вызова — фоновый и
 * подобравший его опрос — иначе ответили бы клиенту дважды.
 *
 * Ставится `answering`, а не сразу `answered`: между этим мигом и
 * ответом лежит поход к чужому провайдеру, и упавший на полпути процесс
 * иначе оставил бы клиента без ответа навсегда — страховка искала бы
 * незакрытые, а это выглядело бы закрытым.
 */
async function claimPending(ctx: CoreConfig, clientId: bigint): Promise<Pending | null> {
  return ctx.db.transaction(async (tx) => {
    /*
     * Отвечаем на последнее из ждущих: клиент, написавший три сообщения
     * подряд, задал один вопрос, а не три, и три ответа на него — это
     * разговор с автоответчиком.
     *
     * Выбирается отдельно, а не подзапросом внутри изменения: условие
     * «что вправе взять» одно на выбор и на занятие, и подзапрос
     * повторял бы его вторым текстом.
     */
    const [target] = await tx
      .select({ id: clientMessages.id })
      .from(clientMessages)
      .where(and(eq(clientMessages.clientId, clientId), claimable(new Date())))
      .orderBy(desc(clientMessages.seq))
      .limit(1);

    if (!target) return null;

    // Занятие условным изменением: два наложившихся вызова иначе
    // ответили бы клиенту дважды. Второй не найдёт строки.
    const [claimed] = await tx
      .update(clientMessages)
      .set({ conciergeOutcome: 'answering' })
      .where(and(eq(clientMessages.id, target.id), claimable(new Date())))
      .returning();

    if (!claimed) return null;

    // Остальные ждущие закрываются тем же ответом: он отвечает на всю
    // череду, а незакрытыми они оставили бы опросу вечную работу.
    await tx
      .update(clientMessages)
      .set({ conciergeOutcome: 'answered' })
      .where(
        and(
          eq(clientMessages.clientId, clientId),
          inArray(clientMessages.conciergeOutcome, ['pending', 'answering']),
          ne(clientMessages.id, claimed.id),
        ),
      );

    const feed = await tx
      .select({
        direction: clientMessages.direction,
        body: clientMessages.body,
      })
      .from(clientMessages)
      .where(eq(clientMessages.clientId, clientId))
      .orderBy(desc(clientMessages.seq))
      .limit(TURNS_IN_REQUEST);

    /*
     * Здоровался ли консьерж хоть раз — вопрос ко всей ленте, а не к её
     * последним двадцати сообщениям. По окну он здоровался бы заново
     * каждый раз, когда разговор успевал уйти за его край.
     */
    const [greeted] = await tx
      .select({ id: clientMessages.id })
      .from(clientMessages)
      .where(
        and(
          eq(clientMessages.clientId, clientId),
          eq(clientMessages.authoredByConcierge, true),
        ),
      )
      .limit(1);

    return {
      clientId,
      messageId: claimed.id,
      body: claimed.body,
      hasAttachment: claimed.attachmentFileId !== null,
      isFirstAnswer: greeted === undefined,
      conversation: feed
        .reverse()
        .filter((one) => one.body !== null)
        .map((one) => ({
          role: one.direction === 'incoming' ? ('client' as const) : ('service' as const),
          text: one.body!,
        })),
    };
  });
}

/**
 * Что ответить. Здесь и только здесь решается, зовут ли человека.
 *
 * Порядок проверок — от самого дешёвого и самого важного к самому
 * дорогому. Слово из списка идёт до модели и минует её вовсе: провайдер
 * отвечает рвано, а разговор про непришедшие деньги не должен зависеть
 * от чужой сети.
 */
async function decide(
  ctx: CoreConfig,
  source: ConciergeSource,
  pending: Pending,
): Promise<Outcome> {
  /*
   * Изображение — безусловная передача. Скриншот перевода это всегда
   * событие про деньги, а видеть его консьерж не умеет: отвечать по
   * подписи значило бы отвечать на «вот, оплатил», не зная суммы.
   */
  if (pending.hasAttachment) {
    return { escalateBecause: 'клиент прислал изображение' };
  }

  const triggered = pending.body === null ? null : escalationTrigger(pending.body);
  if (triggered !== null) {
    return { escalateBecause: triggered };
  }

  const withinLimits = await withinDailyLimits(ctx, pending.clientId);
  if (!withinLimits) {
    return { escalateBecause: 'исчерпан суточный предел ответов помощника' };
  }

  const facts = await conciergeFacts(ctx, pending.clientId);
  const sources = [facts, ...pending.conversation.map((one) => one.text)];

  let complaints: readonly string[] = [];
  // Два захода: первый — ответ, второй — исправление названной ошибки.
  // Третьего нет: модель, не справившаяся дважды, не справится и на
  // пятый раз, а клиент в это время ждёт.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer: ConciergeAnswer | null = await source.answer({
      instructions: CONCIERGE_INSTRUCTIONS,
      facts,
      conversation: pending.conversation,
      ...(complaints.length > 0 ? { complaints } : {}),
    });

    if (answer === null) {
      return { escalateBecause: 'помощник не ответил' };
    }
    if (answer.needsHuman) {
      return { escalateBecause: 'помощник не смог ответить сам' };
    }

    complaints = replyComplaints({ reply: answer.reply, sources });
    if (complaints.length === 0) {
      return { reply: answer.reply.trim() };
    }
  }

  return { escalateBecause: `ответ помощника не прошёл проверку: ${complaints[0]}` };
}

/**
 * Записать исход и собрать то, что уходит по сети.
 *
 * Уведомление сотрудникам здесь не собирается: его заберёт та же
 * операция, что забирает обращения и новые заявки, — отправить его
 * клиентский деплой всё равно не может (docs/adr/0005).
 */
async function settle(
  ctx: CoreConfig,
  pending: Pending,
  outcome: Outcome,
): Promise<AnswerAsConciergeResult> {
  const body =
    'reply' in outcome
      ? pending.isFirstAnswer
        ? `${CONCIERGE_GREETING}\n\n${outcome.reply}`
        : outcome.reply
      : CONCIERGE_HANDOVER;

  await ctx.db.transaction(async (tx) => {
    // Исход дописывается здесь, а не при занятии: занятие ставит
    // «отвечаю», и только этот миг знает, чем всё кончилось. Оставленное
    // на «отвечаю» подберёт страховка — она для того и есть.
    await tx
      .update(clientMessages)
      .set(
        'escalateBecause' in outcome
          ? { conciergeOutcome: 'escalated', escalationReason: outcome.escalateBecause }
          : { conciergeOutcome: 'answered' },
      )
      .where(eq(clientMessages.id, pending.messageId));

    if ('escalateBecause' in outcome) {
      // Метка «ведёт человек» снимается только кнопкой менеджера. Срок
      // тишины пришлось бы угадывать, а разговор, доведённый человеком
      // до конца, к первой линии возвращаться и не должен.
      await tx
        .update(clients)
        .set({ handedToHumanAt: new Date() })
        .where(
          and(
            eq(clients.telegramUserId, pending.clientId),
            isNull(clients.handedToHumanAt),
          ),
        );
    }

    await tx.insert(clientMessages).values({
      clientId: pending.clientId,
      direction: 'outgoing',
      body,
      authoredByConcierge: true,
    });
  });

  return {
    notifications: [{ kind: 'concierge-message', to: pending.clientId, body }],
    handedToHuman: 'escalateBecause' in outcome,
  };
}

/**
 * Уложился ли консьерж в суточные пределы — личный клиента и общий.
 *
 * Считается запросом по ленте, а не счётчиком в отдельной строке:
 * счётчик пришлось бы согласовывать с лентой и сбрасывать по часам, а
 * расходится такое согласие молча.
 */
async function withinDailyLimits(ctx: CoreConfig, clientId: bigint): Promise<boolean> {
  const settings = await readServiceSettings(ctx.db);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [mine] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(clientMessages)
    .where(
      and(
        eq(clientMessages.clientId, clientId),
        eq(clientMessages.authoredByConcierge, true),
        gte(clientMessages.createdAt, since),
      ),
    );
  if ((mine?.count ?? 0) >= settings.conciergeRepliesPerClientDaily) return false;

  const [all] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(clientMessages)
    .where(
      and(
        eq(clientMessages.authoredByConcierge, true),
        gte(clientMessages.createdAt, since),
      ),
    );

  return (all?.count ?? 0) < settings.conciergeRepliesDaily;
}

/**
 * Клиенты, чьё сообщение консьерж взял и не ответил.
 *
 * Страховка на случай, когда фоновая попытка не дошла: процесс
 * перезапустили выкаткой, обработчик упал, провайдер завис дольше
 * своего срока. Без неё такой клиент остался бы без ответа вовсе — а
 * заметил бы это он, а не сервис.
 *
 * Отдельной выборкой, а не отметкой «ответ не ушёл»: отметку пришлось
 * бы держать в согласии с самой лентой, и расходится такое согласие
 * молча. Здесь же вопрос задаётся ленте напрямую.
 */
export async function listConversationsAwaitingConcierge(
  ctx: CoreConfig,
): Promise<readonly bigint[]> {
  if (!hasConcierge(ctx)) return [];

  const rows = await ctx.db
    .selectDistinct({ clientId: clientMessages.clientId })
    .from(clientMessages)
    .where(claimable(new Date()));

  return rows.map((row) => row.clientId);
}

/**
 * Передать разговор человеку — кнопкой менеджера.
 *
 * Нужна не только консьержу: менеджер видит разговор, который бот ведёт
 * не туда, и забирает его до того, как клиент об этом попросит.
 */
export async function handOverToHuman(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
): Promise<void> {
  requireStaff(actor);
  await setHandover(ctx, clientId, new Date());
}

/** Вернуть разговор консьержу. Только кнопкой: сам он не возвращается. */
export async function returnToConcierge(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
): Promise<void> {
  requireStaff(actor);
  await setHandover(ctx, clientId, null);
}

async function setHandover(
  ctx: CoreConfig,
  clientId: bigint,
  at: Date | null,
): Promise<void> {
  const [updated] = await ctx.db
    .update(clients)
    .set({ handedToHumanAt: at })
    .where(eq(clients.telegramUserId, clientId))
    .returning({ id: clients.telegramUserId });

  if (!updated) {
    throw new NotFoundError('Клиент не найден');
  }
}
