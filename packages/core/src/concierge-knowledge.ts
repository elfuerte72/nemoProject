import { asc, eq } from 'drizzle-orm';
import { conciergeKnowledge } from '@nemo/db';
import { requireAdmin, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';

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
  /** Чем выше, тем раньше статья попадает в справку. */
  readonly position?: number | undefined;
  readonly isActive?: boolean | undefined;
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

  const values = {
    title,
    body,
    position: input.position ?? 0,
    isActive: input.isActive ?? true,
    updatedAt: new Date(),
  };

  if (input.id === undefined) {
    const [created] = await ctx.db.insert(conciergeKnowledge).values(values).returning();
    return created!;
  }

  const [updated] = await ctx.db
    .update(conciergeKnowledge)
    .set(values)
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
