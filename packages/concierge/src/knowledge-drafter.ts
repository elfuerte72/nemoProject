import Anthropic from '@anthropic-ai/sdk';
import type {
  DraftedArticle,
  KnowledgeDraftRequest,
  KnowledgeDraftResult,
  KnowledgeDrafter,
} from '@nemo/core';
import type { DeepSeekOptions } from './deepseek.js';

/**
 * Черновик статей базы знаний на DeepSeek.
 *
 * Тот же провайдер и тот же клиент, что у консьержа, — но другая работа:
 * не ответить клиенту за секунды, а прочитать документ администратора
 * целиком и разложить его на статьи. Отсюда другие пределы: ответ
 * длиной в документ, а не в три фразы, и срок, за который модель успеет
 * прочитать двадцать страниц, — на том конце ждёт администратор с
 * кнопкой, а не клиент со «печатает…».
 *
 * Формат ответа — договор этого модуля с моделью, и ядро его не знает:
 * статья начинается строкой `# Название`, под ней текст. Структурного
 * вывода у совместимого эндпоинта нет, а заголовок решёткой дешёвая
 * модель ставит надёжно — она так пишет и без просьбы.
 */

/** Чем модель говорит, что фактов о сервисе в документе нет. */
const EMPTY_MARK = 'ПУСТО';

/**
 * Потолок ответа в токенах.
 *
 * Документ на двадцать страниц даёт статей на страниц пять: кириллица
 * дороже латиницы, и восемь тысяч токенов — это примерно двенадцать
 * тысяч знаков русского текста. Упёршись в потолок, модель обрывает
 * последнюю статью на полуслове — такая отбрасывается, а ядру
 * говорится, что документ разобран не целиком.
 */
const MAX_TOKENS = 8192;

/** Две минуты: столько модель читает большой документ, а ждёт её администратор. */
const DEFAULT_TIMEOUT_MS = 120_000;

export function createDeepSeekKnowledgeDrafter(options: DeepSeekOptions): KnowledgeDrafter {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
    // Без повторов внутри клиента: администратор видит отказ словами и
    // жмёт кнопку снова сам, а три молчаливых захода подряд — это шесть
    // минут ожидания перед тем же отказом.
    maxRetries: 0,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    async draft(request: KnowledgeDraftRequest): Promise<KnowledgeDraftResult | null> {
      try {
        const message = await client.messages.create({
          model: options.model,
          max_tokens: MAX_TOKENS,
          // Думание выключено по той же причине, что и у консьержа: блок
          // размышления делит потолок с ответом, а разметить документ
          // заголовками — не задача на размышление.
          thinking: { type: 'disabled' },
          system: renderSystem(request),
          messages: [{ role: 'user', content: request.text }],
        });

        return readDraft(message);
      } catch (error) {
        // Молчание провайдера — рабочее состояние: администратор
        // повторит разбор позже. Запись в журнал, а не исключение наружу.
        console.error('Документ не разобран:', error);
        return null;
      }
    },
  };
}

function renderSystem(request: KnowledgeDraftRequest): string {
  return [
    request.instructions,
    '',
    'Формат ответа. Только статьи, без вступления и без слов от себя.',
    'Каждая статья начинается строкой «# Название», под ней текст статьи.',
    'Между статьями пустая строка.',
    `Если фактов о сервисе для клиента в документе нет — ответь одной строкой: ${EMPTY_MARK}`,
  ].join('\n');
}

/**
 * Статьи из текста ответа: заголовок решёткой открывает статью, всё до
 * первого заголовка — вступление, которое модели велено не писать, и
 * статьёй оно не считается: названия у него нет, а сочинять его за
 * модель нельзя.
 */
function readDraft(message: Anthropic.Message): KnowledgeDraftResult {
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const truncated = message.stop_reason === 'max_tokens';
  if (text.toUpperCase() === EMPTY_MARK) return { articles: [], truncated };

  const articles: { title: string; body: string[] }[] = [];
  for (const line of text.split('\n')) {
    const heading = /^\s*#+\s*(.+?)\s*$/.exec(line);
    if (heading) {
      articles.push({ title: heading[1]!, body: [] });
      continue;
    }
    articles.at(-1)?.body.push(line);
  }

  const read: DraftedArticle[] = articles.map((one) => ({
    title: one.title,
    body: one.body.join('\n').trim(),
  }));

  // Оборванная по потолку последняя статья — обрубок, а не статья.
  return { articles: truncated ? read.slice(0, -1) : read, truncated };
}

/**
 * Черновик из тех же переменных окружения, что и консьерж. Ключа нет —
 * разбор документов выключен, статьи заводятся руками: рабочее
 * состояние, а не поломка.
 */
export function knowledgeDrafterFromEnvironment(): KnowledgeDrafter | undefined {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return undefined;

  return createDeepSeekKnowledgeDrafter({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
  });
}
