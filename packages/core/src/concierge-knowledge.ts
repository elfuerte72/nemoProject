import { asc, eq, sql } from 'drizzle-orm';
import { conciergeKnowledge } from '@nemo/db';
import { knowledgeTitleFamily, normalizeKnowledgeTitle } from '@nemo/types';
import { requireAdmin, type Actor } from './actor.js';
import { slopComplaints } from './bot-slop.js';
import { TIME_UNIT } from './concierge-guard.js';
import type { CoreConfig, Executor } from './context.js';
import { InvalidInputError, NotFoundError, UnavailableError } from './errors.js';
import type { DraftedArticle } from './knowledge-drafter.js';

/**
 * База знаний консьержа: что он знает о сервисе.
 *
 * Ведёт её администратор, а не разработчик, и это осознанное отступление
 * от правила, по которому тексты бота живут в коде. Разница в том, что
 * здесь лежит: не формулировки, которыми сервис говорит, а факты, о
 * которых он говорит, — график, банки, сроки, чего сервис не делает.
 * Факты меняются в тот день, когда меняются, и ждать выкатки не могут.
 *
 * Голос при этом остаётся в коде: характер, тон и запреты
 * (`concierge-voice.ts`) администратору не отданы. Иначе одно неверное
 * слово в поле меняло бы поведение у всех клиентов сразу и без отката.
 *
 * Администратор, а не менеджер: состав знаний — решение о том, что
 * сервис говорит о себе, а не шаг по заявке.
 *
 * Попадают статьи в базу двумя путями. Руками — одна за раз, название и
 * текст. Документом — администратор приносит регламент, памятку или
 * ответы на частые вопросы, модель делит текст на статьи, ядро их
 * причёсывает и показывает черновиком, и записывается только то, что
 * администратор подтвердил (docs/adr/0016). Черновик до записи
 * обязателен: модель читает чужой документ и ошибается, а статья уходит
 * клиентам через помощника — записанная не глядя, она стоит того же,
 * что выдуманный курс.
 */

/**
 * Сколько текста принимаем в статью.
 *
 * Четыре тысячи знаков — это страница: столько занимает связный ответ на
 * один вопрос вместе с оговорками. Длиннее — не статья, а раздел, и
 * разбитый надвое он и модели читается лучше, и правится по частям.
 */
const MAX_BODY = 4000;
const MAX_TITLE = 120;

/**
 * Сколько текста принимаем в разбор за раз.
 *
 * Шестьдесят тысяч знаков — это страниц двадцать пять: столько занимает
 * регламент целиком. Больше — не документ, а архив, и разобранный одним
 * заходом он упрётся в потолок ответа модели: хвост потеряется молча.
 */
const MAX_DOCUMENT = 60_000;

/**
 * Сколько текста уходит модели за один запрос.
 *
 * Потолок её ответа — около двенадцати тысяч знаков статей, и документ
 * длиннее этого обрывался бы на полуслове. Поэтому длинный документ
 * режется по абзацам на части по десять тысяч знаков, каждая уходит
 * своим запросом, статьи собираются по порядку. Модель при этом не
 * видит соседних частей — и не должна: статья отвечает на один вопрос,
 * а не связывает главы.
 */
const CHUNK_CHARS = 10_000;

/**
 * Шаг позиции между статьями. С зазором, а не подряд: между двумя
 * соседними всегда можно вставить третью, не сдвигая остальные.
 */
const POSITION_STEP = 10;

/**
 * Инструкция редактора: что в документе считать статьёй.
 *
 * В коде и через ревью — по той же причине, что и голос консьержа: она
 * решает, что из чужого документа дойдёт до клиентов. Формат ответа
 * здесь не описан: как разметить статьи в тексте — договор модели с
 * её реализацией, и живёт он рядом с разбором ответа.
 */
export const KNOWLEDGE_DRAFT_INSTRUCTIONS = [
  'Ты — редактор базы знаний помощника обменника TOBEE.',
  'Помощник отвечает клиентам в Telegram по статьям из этой базы: чего',
  'в ней нет, того он не скажет.',
  '',
  'Тебе дан документ владельца сервиса: регламент, памятка, ответы на',
  'частые вопросы, переписка. Разбери его на статьи. Одна статья — один',
  'вопрос клиента и ответ на него: «Какие банки», «Сроки перевода»,',
  '«Что с возвратами».',
  '',
  'Название — два-пять слов о том, о чём статья, как тема вопроса.',
  'Текст — фактами, как ответил бы клиенту сотрудник за стойкой: на',
  '«вы», по-русски, фразами, без списков, заголовков, звёздочек и',
  'смайликов. Абзац или два, до восьмисот знаков; тема шире — две',
  'статьи, а не одна длинная.',
  '',
  'В статьи идёт то, что клиенту полезно знать о сервисе: что он',
  'делает и чего не делает, как проходит обмен, условия, ограничения,',
  'способы оплаты и получения, что делать в спорной ситуации.',
  'Сохраняй конкретику: названия банков, валют, стран, условия.',
  '',
  'Чего в статьях не бывает:',
  '- того, чего нет в документе: ничего не додумывай и не обобщай;',
  '- чисел, которых нет в документе;',
  '- минимальной суммы, наценки и курса: помощник получает их живыми из',
  '  настроек сервиса, а записанные они устареют;',
  '- внутренней кухни: инструкций сотрудникам, имён, паролей, доступов,',
  '  номеров счетов, ссылок на внутренние системы;',
  '- обращений к сотрудникам и заметок автора документа;',
  '- советов и призывов от себя: «уточняйте», «обращайтесь», «будьте',
  '  внимательны» — помощник скажет это сам, если будет нужно.',
  '',
  'Если фактов о сервисе для клиента в документе нет — так и скажи.',
].join('\n');

export interface KnowledgeArticleView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly position: number;
  readonly isActive: boolean;
  readonly updatedAt: Date;
}

export interface SaveKnowledgeArticleInput {
  /** Пусто — заводится новая статья. */
  readonly id?: string | undefined;
  readonly title: string;
  readonly body: string;
  /**
   * Место в справке: чем меньше, тем раньше. Не задано — новая статья
   * встаёт в конец, а у правимой место не меняется.
   */
  readonly position?: number | undefined;
  readonly isActive?: boolean | undefined;
}

export interface KnowledgeDraftInput {
  /** Текст документа: из файла его уже вытащил адаптер. */
  readonly text: string;
}

/**
 * Статья черновика: что запишется и о чём администратору стоит знать.
 *
 * Какую статью заменит одноимённая, здесь не названо: название в
 * черновике правят до записи, и названное при разборе устарело бы на
 * первой же правке. Экран считает это сам по списку статей — тем же
 * правилом `normalizeKnowledgeTitle`, что и запись.
 */
export interface DraftedArticleView {
  readonly title: string;
  readonly body: string;
  /**
   * О чём предупредить: срок в тексте и признаки машинного набора.
   * Предупреждение, а не отказ: администратор вправе записать «перевод
   * идёт до часа» — но должен знать, что тем самым разрешил помощнику
   * обещать срок.
   */
  readonly warnings: readonly string[];
}

export interface KnowledgeDraftView {
  readonly articles: readonly DraftedArticleView[];
  /** Хвост документа не разобран: модель упёрлась в потолок ответа. */
  readonly truncated: boolean;
}

/** Статья, которую администратор подтвердил из черновика. */
export interface NewKnowledgeArticle {
  readonly title: string;
  readonly body: string;
}

export async function listKnowledgeArticles(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly KnowledgeArticleView[]> {
  requireAdmin(actor);

  // В том же порядке, в каком они уходят в справку: администратор
  // правит то, что видит модель, и порядок — часть этого.
  return ctx.db
    .select()
    .from(conciergeKnowledge)
    .orderBy(asc(conciergeKnowledge.position), asc(conciergeKnowledge.title));
}

export async function saveKnowledgeArticle(
  ctx: CoreConfig,
  actor: Actor,
  input: SaveKnowledgeArticleInput,
): Promise<KnowledgeArticleView> {
  requireAdmin(actor);

  const { title, body } = validated(input);
  await requireTitleFree(ctx.db, title, input.id);
  const values = {
    title,
    body,
    isActive: input.isActive ?? true,
    updatedAt: new Date(),
  };

  if (input.id === undefined) {
    const position = input.position ?? (await nextPosition(ctx.db));
    const [created] = await ctx.db
      .insert(conciergeKnowledge)
      .values({ ...values, position })
      .returning();
    return created!;
  }

  const [updated] = await ctx.db
    .update(conciergeKnowledge)
    .set({ ...values, ...(input.position === undefined ? {} : { position: input.position }) })
    .where(eq(conciergeKnowledge.id, input.id))
    .returning();
  if (!updated) {
    throw new NotFoundError('Статья не найдена');
  }
  return updated;
}

/**
 * Погасить или вернуть статью.
 *
 * Гашение, а не удаление: статья, из-за которой помощник что-то сказал,
 * должна остаться читаемой после того, как её убрали. Разбирать, откуда
 * взялся ответ, приходится задним числом.
 */
export async function setKnowledgeArticleActive(
  ctx: CoreConfig,
  actor: Actor,
  id: string,
  isActive: boolean,
): Promise<KnowledgeArticleView> {
  requireAdmin(actor);

  const [updated] = await ctx.db
    .update(conciergeKnowledge)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(conciergeKnowledge.id, id))
    .returning();
  if (!updated) {
    throw new NotFoundError('Статья не найдена');
  }
  return updated;
}

/** Разбирает ли этот деплой документы. Панель по этому решает, что показать. */
export function hasKnowledgeDrafter(ctx: CoreConfig): boolean {
  return ctx.knowledgeDrafter !== undefined;
}

/**
 * Черновик статей из документа.
 *
 * Ничего не записывает: модель читает чужой текст и ошибается, и до
 * базы её статьи доходят только через глаза администратора. Ядро при
 * этом делает то, что от модели требовать нельзя: обрезает по краям,
 * укорачивает название, делит длинное по абзацам и предупреждает о
 * сроках и машинном ритме.
 */
export async function draftKnowledgeArticles(
  ctx: CoreConfig,
  actor: Actor,
  input: KnowledgeDraftInput,
): Promise<KnowledgeDraftView> {
  requireAdmin(actor);

  const drafter = ctx.knowledgeDrafter;
  if (!drafter) {
    throw new InvalidInputError(
      'Разбор документов выключен: у панели нет ключа провайдера. Статью можно написать руками.',
    );
  }

  const text = input.text.trim();
  if (!text) {
    throw new InvalidInputError('Текст пустой: вставьте его в поле или выберите файл');
  }
  if (text.length > MAX_DOCUMENT) {
    throw new InvalidInputError(
      `Документ длиннее ${MAX_DOCUMENT.toLocaleString('ru-RU')} знаков: разделите его на части и пришлите по одной`,
    );
  }

  // Части идут разом: администратор ждёт у кнопки, и пять запросов
  // подряд — это пять ожиданий вместо одного.
  const results = await Promise.all(
    splitText(text, CHUNK_CHARS).map((chunk) =>
      drafter.draft({ instructions: KNOWLEDGE_DRAFT_INSTRUCTIONS, text: chunk }),
    ),
  );
  if (results.some((one) => one === null)) {
    // Половина черновика без слов о второй половине читалась бы как весь
    // документ: отказ целиком, повтор — целиком.
    throw new UnavailableError('Помощник не ответил: провайдер молчит. Повторите разбор через минуту');
  }

  const articles = results
    .flatMap((one) => one!.articles)
    .flatMap(tidy)
    .map((article): DraftedArticleView => ({
      ...article,
      warnings: knowledgeArticleWarnings(article.body, text),
    }));

  return { articles, truncated: results.some((one) => one!.truncated) };
}

/**
 * Записать подтверждённый черновик.
 *
 * Одной транзакцией: администратор подтвердил список целиком, и
 * записанная половина при негодной второй читалась бы как «записалось
 * всё». Одноимённая статья заменяется на месте — документ присылают
 * обновлённым, и вторая «Оплата» рядом с первой сбила бы и модель, и
 * администратора; новая встаёт в конец в том порядке, в каком
 * подтверждена.
 */
export async function addKnowledgeArticles(
  ctx: CoreConfig,
  actor: Actor,
  articles: readonly NewKnowledgeArticle[],
): Promise<readonly KnowledgeArticleView[]> {
  requireAdmin(actor);

  if (articles.length === 0) {
    throw new InvalidInputError('В черновике не осталось статей: записывать нечего');
  }
  const clean = articles.map(validated);

  // Две одноимённые в одном черновике — не замена, а потеря: вторая
  // перезаписала бы первую молча, а панель отчиталась бы о двух.
  const seen = new Map<string, string>();
  for (const article of clean) {
    const key = normalizeKnowledgeTitle(article.title);
    const first = seen.get(key);
    if (first !== undefined) {
      throw new InvalidInputError(
        `Две статьи с названием «${first}»: объедините их или переименуйте одну`,
      );
    }
    seen.set(key, article.title);
  }

  return ctx.db.transaction(async (tx) => {
    // В порядке справки: экран называет заменяемую статью первой по
    // этому же порядку, и ядро обязано заменить её же.
    const existing = await tx
      .select({
        id: conciergeKnowledge.id,
        title: conciergeKnowledge.title,
        isActive: conciergeKnowledge.isActive,
      })
      .from(conciergeKnowledge)
      .orderBy(asc(conciergeKnowledge.position), asc(conciergeKnowledge.title));
    const byTitle = new Map<string, string>();
    for (const row of existing) {
      const key = normalizeKnowledgeTitle(row.title);
      if (!byTitle.has(key)) byTitle.set(key, row.id);
    }
    let position = await nextPosition(tx);

    const saved: KnowledgeArticleView[] = [];
    const touched = new Set<string>();
    for (const article of clean) {
      const values = { ...article, isActive: true, updatedAt: new Date() };
      const id = byTitle.get(normalizeKnowledgeTitle(article.title));
      if (id !== undefined) {
        const [updated] = await tx
          .update(conciergeKnowledge)
          .set(values)
          .where(eq(conciergeKnowledge.id, id))
          .returning();
        saved.push(updated!);
        touched.add(id);
        continue;
      }
      const [created] = await tx
        .insert(conciergeKnowledge)
        .values({ ...values, position })
        .returning();
      saved.push(created!);
      touched.add(created!.id);
      position += POSITION_STEP;
    }

    /*
     * Прежние части тех же тем, которых в черновике больше нет, гасятся:
     * документ прислали заново, и хвост старой версии рядом с новой
     * читался бы помощником как ещё одна правда. Сюда же попадают
     * одноимённые дубли, оставшиеся с тех пор, когда одноимённость не
     * проверялась. Гашение, а не удаление — по общему правилу базы.
     */
    const families = new Set(clean.map((article) => knowledgeTitleFamily(article.title)));
    const stale = existing.filter(
      (row) => row.isActive && !touched.has(row.id) && families.has(knowledgeTitleFamily(row.title)),
    );
    for (const row of stale) {
      await tx
        .update(conciergeKnowledge)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(conciergeKnowledge.id, row.id));
    }

    return saved;
  });
}

/**
 * Что администратору стоит знать о статье до записи — по её тексту и по
 * документу, из которого она взята. Отдельной операцией, потому что
 * текст в черновике правят, и предупреждение обязано отвечать тому, что
 * запишется, а не тому, что модель прислала.
 */
export function warnAboutKnowledgeArticle(
  actor: Actor,
  input: { readonly body: string; readonly source: string },
): readonly string[] {
  requireAdmin(actor);
  return knowledgeArticleWarnings(input.body, input.source);
}

/**
 * Название свободно — или отказ словами. Одноимённая статья заводится
 * не второй строкой, а правкой первой: две «Оплаты» в справке помощник
 * читал бы как две правды, а администратор — как одну.
 */
async function requireTitleFree(executor: Executor, title: string, ownId?: string): Promise<void> {
  const key = normalizeKnowledgeTitle(title);
  const rows = await executor
    .select({ id: conciergeKnowledge.id, title: conciergeKnowledge.title })
    .from(conciergeKnowledge);
  const clash = rows.find((row) => row.id !== ownId && normalizeKnowledgeTitle(row.title) === key);
  if (clash) {
    throw new InvalidInputError(`Статья «${clash.title}» уже есть: откройте её и поправьте`);
  }
}

/** Название и текст по правилам статьи — или отказ словами. */
function validated(input: { title: string; body: string }): { title: string; body: string } {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) {
    throw new InvalidInputError('У статьи должно быть название');
  }
  if (title.length > MAX_TITLE) {
    throw new InvalidInputError(`Название длиннее ${MAX_TITLE} знаков`);
  }
  if (!body) {
    throw new InvalidInputError('Пустая статья ничего не добавляет помощнику');
  }
  if (body.length > MAX_BODY) {
    throw new InvalidInputError(
      `Статья длиннее ${MAX_BODY} знаков: разбейте её на две — так её прочитают и вы, и помощник`,
    );
  }
  return { title, body };
}

async function nextPosition(executor: Executor): Promise<number> {
  const [row] = await executor
    .select({ last: sql<number | null>`max(${conciergeKnowledge.position})` })
    .from(conciergeKnowledge);
  return (row?.last ?? 0) + POSITION_STEP;
}

/**
 * Статья модели — в статьи ядра: без пустых, обрезанная по краям, с
 * названием по потолку и текстом, разделённым на части, если он длиннее
 * страницы. Части нумеруются в названии: «Как проходит обмен (1)».
 */
function tidy(article: DraftedArticle): readonly { title: string; body: string }[] {
  const title = shortenTitle(article.title.trim().replace(/\s+/g, ' '));
  const body = article.body.trim();
  if (!title || !body) return [];

  const parts = splitText(body, MAX_BODY);
  if (parts.length === 1) return [{ title, body: parts[0]! }];

  const base = shortenTitle(title, MAX_TITLE - ` (${parts.length})`.length);
  return parts.map((part, index) => ({ title: `${base} (${index + 1})`, body: part }));
}

/** Укоротить название по слову, а не по букве: обрубок слова — не название. */
function shortenTitle(title: string, limit: number = MAX_TITLE): string {
  if (title.length <= limit) return title;
  const cut = title.slice(0, limit + 1);
  const atSpace = cut.lastIndexOf(' ');
  return (atSpace > 0 ? cut.slice(0, atSpace) : cut.slice(0, limit)).trim();
}

/**
 * Разделить текст на части не длиннее предела: по абзацам, длинный
 * абзац — по предложениям, а предложение длиннее предела — как придётся.
 * Части собираются жадно: в одну кладётся столько абзацев, сколько
 * влезает, — иначе документ из коротких абзацев рассыпался бы на
 * десятки кусков. Одно правило на два предела: статью делит потолок
 * статьи, документ — потолок запроса к модели.
 */
function splitText(text: string, limit: number): readonly string[] {
  if (text.length <= limit) return [text];

  const units: { sep: string; text: string }[] = [];
  text.split(/\n\s*\n/).forEach((paragraph, index) => {
    const before = index === 0 ? '' : '\n\n';
    if (paragraph.length <= limit) {
      units.push({ sep: before, text: paragraph });
      return;
    }
    paragraph.split(/(?<=[.!?…])\s+/).forEach((sentence, at) => {
      hardChunks(sentence, limit).forEach((chunk, piece) => {
        units.push({ sep: piece > 0 ? '' : at === 0 ? before : ' ', text: chunk });
      });
    });
  });

  const parts: string[] = [];
  let current = '';
  for (const unit of units) {
    const joined = current === '' ? unit.text : `${current}${unit.sep}${unit.text}`;
    if (joined.length <= limit) {
      current = joined;
      continue;
    }
    if (current !== '') parts.push(current);
    current = unit.text;
  }
  if (current !== '') parts.push(current);
  return parts;
}

function hardChunks(text: string, limit: number): readonly string[] {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += limit) {
    chunks.push(text.slice(at, at + limit));
  }
  return chunks;
}

/**
 * Совет от себя: «уточняйте», «обращайтесь», «пожалуйста». Модели велено
 * этого не писать, и дешёвая модель пишет всё равно — проверено на живом
 * провайдере 5 сентября 2026. Ловится по документу: слово, которого в
 * нём нет, дописано от себя.
 */
const ADVICE =
  /(?<!\p{L})(уточняйте|уточните|обращайтесь|обратитесь|пожалуйста|рекомендуем|не забудьте|будьте внимательны)(?!\p{L})/giu;

/**
 * О чём предупредить до записи. Единица времени — потому что застава
 * разрешает срок в ответе, если его назвала справка; машинный ритм —
 * тем же правилом, что и тексты бота; совет от себя — потому что его
 * не было в документе, а прочитает его клиент.
 */
function knowledgeArticleWarnings(body: string, source: string): readonly string[] {
  const warnings = [...slopComplaints(body)];
  if (TIME_UNIT.test(body)) {
    warnings.push('называет срок: помощник сможет обещать его клиентам');
  }
  const lower = source.toLowerCase();
  for (const match of new Set(body.match(ADVICE)?.map((one) => one.toLowerCase()) ?? [])) {
    if (!lower.includes(match)) {
      warnings.push(`«${match}»: в документе этого не было, дописано от себя`);
    }
  }
  return warnings;
}
