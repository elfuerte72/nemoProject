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
import { attachmentFactsOf, describeAttachment, type AttachmentFacts } from './attachments.js';
import { clientMessages, clients } from '@nemo/db';
import { requireStaff, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { conciergeFacts } from './concierge-facts.js';
import { replyComplaints } from './concierge-guard.js';
import type {
  ConciergeAnswer,
  ConciergeHintKey,
  ConciergeSource,
  ConciergeTurn,
} from './concierge-source.js';
import { escalationTrigger } from './concierge-triggers.js';
import {
  CONCIERGE_GREETING,
  CONCIERGE_HANDOVER,
  CONCIERGE_HELLO,
  CONCIERGE_HINTS,
  CONCIERGE_INSTRUCTIONS,
  CONCIERGE_OFFTOPIC,
  isGreetingOnly,
} from './concierge-voice.js';
import { NotFoundError } from './errors.js';
import { publishLiveEvent } from './live-events.js';
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
 * Пауза накопления: сколько тишины консьерж ждёт, прежде чем взять
 * череду. Человек пишет мысль несколькими сообщениями — «Привет»,
 * «мне нужна карта», «вы тут?» — и ответ на каждое стоит захода к
 * провайдеру, читаясь при этом разговором с автоответчиком. Побочно
 * пауза глушит грубый флуд: пока сообщения сыплются чаще, чем раз в
 * эту паузу, тишина не наступает и модель не зовётся вовсе.
 *
 * Экспортируется для адаптера: фон, вызывающий операцию, должен ждать
 * не меньше — иначе его вызовы приходят до тишины и работают вхолостую.
 */
export const CONCIERGE_QUIET_MS = 6 * 1000;

/**
 * Сколько ответов клиенту помещается в минуту.
 *
 * Предохранитель от спама, который пауза не ловит, — сообщений раз в
 * десять секунд. Сверх предела череда не эскалируется (вручить спамеру
 * живого менеджера — приз за флуд), а откладывается: сообщения лежат
 * ждущими, и следующее окно отвечает на всё одним разом.
 *
 * Константа, а не настройка: минутный предел защищает механику
 * разговора, а деньги провайдера режут суточные пределы — те в
 * настройках. Пересматривается вместе с ними по счёту за первую
 * неделю (тикет 05).
 */
const REPLIES_PER_CLIENT_PER_MINUTE = 4;

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
  /**
   * Тексты всей закрываемой череды, от старшего к младшему. Триггеры
   * слушают её целиком: жалоба приходит и предпоследним сообщением, а
   * закрытая молча она не дошла бы до человека.
   */
  readonly bodies: readonly string[];
  /**
   * Вложение в любом сообщении череды, старшее из них: скриншот и
   * подпись к нему клиент шлёт врозь, а менеджеру называется то, с чего
   * началось.
   */
  readonly attachment: AttachmentFacts | null;
  /** Первый ответ в разговоре: только в нём консьерж представляется. */
  readonly isFirstAnswer: boolean;
  readonly conversation: readonly ConciergeTurn[];
}

/**
 * Чем кончилось: текст клиенту либо причина позвать человека.
 *
 * `ready` — текст готовый, из кода: он сам представляет помощника, и
 * клеить поверх него представление первого ответа значило бы
 * представиться дважды.
 */
type Outcome =
  | { readonly reply: string; readonly ready?: boolean; readonly hint?: ConciergeHintKey }
  | { readonly escalateBecause: string };

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
  const quietMs = ctx.conciergeQuietMs ?? CONCIERGE_QUIET_MS;

  return ctx.db.transaction(async (tx) => {
    /*
     * Берётся вся ждущая череда, а отвечается её последнее: клиент,
     * написавший три сообщения подряд, задал один вопрос, а не три, и
     * три ответа на него — это разговор с автоответчиком. Но триггеры и
     * вложения потом проверяются по каждому сообщению череды: жалоба,
     * пришедшая предпоследним, иначе закрывалась бы молча.
     *
     * Выбирается отдельно, а не подзапросом внутри изменения: условие
     * «что вправе взять» одно на выбор и на занятие, и подзапрос
     * повторял бы его вторым текстом.
     */
    const batch = await tx
      .select({
        id: clientMessages.id,
        body: clientMessages.body,
        createdAt: clientMessages.createdAt,
        attachmentFileId: clientMessages.attachmentFileId,
        attachmentKind: clientMessages.attachmentKind,
        attachmentName: clientMessages.attachmentName,
        attachmentSize: clientMessages.attachmentSize,
      })
      .from(clientMessages)
      .where(and(eq(clientMessages.clientId, clientId), claimable(new Date())))
      .orderBy(desc(clientMessages.seq));

    const target = batch[0];
    if (!target) return null;

    // Пауза накопления: клиент ещё пишет, и взятая сейчас череда
    // получила бы ответ на половину мысли. Ждём тишины; вызов,
    // назначенный последним сообщением, придёт после неё.
    if (target.createdAt.getTime() > Date.now() - quietMs) return null;

    /*
     * Минутный предел решается до занятия: занятую череду пришлось бы
     * возвращать. Эскалации предел не касается — вложение и триггерное
     * слово уводят к человеку без похода к провайдеру, а разговор про
     * непришедшие деньги не откладывают.
     */
    const escalates =
      batch.some((one) => one.attachmentFileId !== null) ||
      batch.some((one) => one.body !== null && escalationTrigger(one.body) !== null);
    if (!escalates && !(await withinMinuteLimit(tx, clientId))) return null;

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
      bodies: batch
        .map((one) => one.body)
        .filter((one): one is string => one !== null)
        .reverse(),
      attachment:
        [...batch].reverse().map(attachmentFactsOf).find((one) => one !== null) ?? null,
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
   * Файл — безусловная передача. Скриншот перевода или PDF-чек это
   * всегда событие про деньги, а видеть их консьерж не умеет: отвечать
   * по подписи значило бы отвечать на «вот, оплатил», не зная суммы.
   * Что именно прислали, менеджер читает в заголовке уведомления.
   */
  if (pending.attachment !== null) {
    return { escalateBecause: `клиент прислал ${describeAttachment(pending.attachment)}` };
  }

  // По каждому сообщению череды, от старшего: причина для менеджера —
  // то, с чего началось, а не то, чем клиент догнал свою же жалобу.
  for (const body of pending.bodies) {
    const triggered = escalationTrigger(body);
    if (triggered !== null) {
      return { escalateBecause: triggered };
    }
  }

  // Голое приветствие — и вся череда из одних приветствий: провайдер не
  // нужен, готовый текст отвечает и представляет помощника сам.
  if (pending.bodies.length > 0 && pending.bodies.every(isGreetingOnly)) {
    return { reply: CONCIERGE_HELLO, ready: true };
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
    // Подсказка «где нажать»: тему назвала модель, а пару картинка +
    // подпись выбирает код — модель к картинкам не прикасается.
    if (answer.hint) {
      return { reply: CONCIERGE_HINTS[answer.hint].caption, ready: true, hint: answer.hint };
    }
    // Болтовня: классифицировала модель, а отвечает готовый текст из
    // кода — формулировка отказа не отдана на сочинение.
    if (answer.offTopic) {
      return { reply: CONCIERGE_OFFTOPIC, ready: true };
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
      ? outcome.ready
        ? outcome.reply
        : pending.isFirstAnswer
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

    // Ответ помощника — такая же строка в переписке, и менеджер, который
    // за ней следит, должен увидеть её без перезагрузки.
    await publishLiveEvent(tx, {
      topic: 'conversations',
      clientId: pending.clientId.toString(),
    });
  });

  const photoPath =
    'reply' in outcome && outcome.hint ? CONCIERGE_HINTS[outcome.hint].photoPath : undefined;

  return {
    notifications: [
      {
        kind: 'concierge-message',
        to: pending.clientId,
        body,
        ...(photoPath ? { photoPath } : {}),
      },
    ],
    handedToHuman: 'escalateBecause' in outcome,
  };
}

/**
 * Уложился ли консьерж в минутный предел ответов этому клиенту.
 *
 * Считается по ленте тем же способом, что и суточные пределы, и по той
 * же причине: счётчик пришлось бы держать в согласии с лентой, а
 * расходится такое согласие молча.
 */
async function withinMinuteLimit(db: Executor, clientId: bigint): Promise<boolean> {
  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clientMessages)
    .where(
      and(
        eq(clientMessages.clientId, clientId),
        eq(clientMessages.authoredByConcierge, true),
        gte(clientMessages.createdAt, new Date(Date.now() - 60 * 1000)),
      ),
    );

  return (recent?.count ?? 0) < REPLIES_PER_CLIENT_PER_MINUTE;
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

  const quietMs = ctx.conciergeQuietMs ?? CONCIERGE_QUIET_MS;

  // Тишина проверяется и здесь: клиент, который ещё пишет, не ждёт
  // консьержа — он ждёт, пока сам допишет. Отложенных минутным пределом
  // выборка при этом показывает: их окно откроет следующий прогон.
  //
  // Порог уходит строкой ISO: у параметра внутри HAVING драйвер не знает
  // типа колонки и дату как дату не связывает.
  const quietBefore = new Date(Date.now() - quietMs).toISOString();
  const rows = await ctx.db
    .select({ clientId: clientMessages.clientId })
    .from(clientMessages)
    .where(claimable(new Date()))
    .groupBy(clientMessages.clientId)
    .having(sql`max(${clientMessages.createdAt}) <= ${quietBefore}`);

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
