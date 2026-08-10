import Anthropic from '@anthropic-ai/sdk';
import type {
  ConciergeAnswer,
  ConciergeRequest,
  ConciergeSource,
  ConciergeTurn,
} from '@nemo/core';

/**
 * Консьерж на DeepSeek.
 *
 * Провайдер спрятан за интерфейсом ядра ровно так же, как источники
 * котировок: какая модель отвечает и чья она — свойство развёртывания, и
 * в правила разговора протекать не должно.
 *
 * Клиент — Anthropic SDK без изменений: у DeepSeek есть совместимый с
 * ним эндпоинт, и ключ с адресом передаются в клиент явно из
 * `DEEPSEEK_API_KEY` и `DEEPSEEK_BASE_URL`. Переменные названы по
 * провайдеру, а не по SDK: иначе `.env` вводит в заблуждение
 * относительно того, чей ключ нужен.
 *
 * Совместимость эта не полная, и запрос собран по нижней границе: ни
 * `effort`, ни структурного вывода здесь нет. Это фирменные возможности
 * Anthropic, и совместимый слой чужого провайдера их не принимает — а
 * отказ вернулся бы не отказом ответа, а четырёхсотой на каждое
 * сообщение клиента.
 *
 * Выключение думания он, наоборот, принимает, и это проверено на живом
 * провайдере, а не выведено из совместимости.
 */

/**
 * Чем модель просит человека.
 *
 * Отдельной первой строкой, а не структурным полем: структурного вывода
 * у совместимого эндпоинта нет, а разбирать просьбу из текста ответа —
 * значит гадать. Слово заглавными и в одиночку на строке дешёвая модель
 * повторяет надёжно, и в живом ответе клиенту оно не встречается.
 */
const HANDOVER_MARK = 'МЕНЕДЖЕР';

/**
 * Чем модель помечает болтовню — сообщение не про сервис.
 *
 * Тот же приём, что и с просьбой о человеке: одиночное слово строкой
 * дешёвая модель повторяет надёжно, а формулировку ответа на болтовню
 * ядро подставляет готовым текстом — сочинять её модели не дают.
 */
const OFFTOPIC_MARK = 'ОФФТОП';

export interface DeepSeekOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  /**
   * Сколько ждать ответа. Клиент в это время смотрит на «печатает…», и
   * бесконечное ожидание для него неотличимо от молчания — только длится
   * дольше. Не дождались — отвечает человек.
   */
  readonly timeoutMs?: number;
  /**
   * Чем ходить в сеть. Подменяется в тестах: настоящего провайдера в
   * прогон не позовёшь, а разбор его ответа проверять надо.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Потолок ответа в токенах.
 *
 * Застава режет ответ длиннее семисот знаков, и просить у модели больше
 * незачем: лишнее всё равно будет отвергнуто, а платится за него сразу.
 * Взято с запасом на кириллицу — она дороже латиницы в токенах.
 */
const MAX_TOKENS = 700;

const DEFAULT_TIMEOUT_MS = 20_000;

export function createDeepSeekConcierge(options: DeepSeekOptions): ConciergeSource {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
    // Повторы отключены: ядро само решает, что делать с молчанием, — и
    // решает быстро, потому что на том конце ждёт человек. Второй заход
    // внутри клиента только удлинил бы это ожидание втрое.
    maxRetries: 0,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    async answer(request: ConciergeRequest): Promise<ConciergeAnswer | null> {
      try {
        const message = await client.messages.create({
          model: options.model,
          max_tokens: MAX_TOKENS,
          // Думание выключено: модель `deepseek-v4-flash` думает вслух и
          // отдаёт блок размышления до ответа, а потолок токенов
          // покрывает оба. Размышление съедало бы бюджет, и клиенту
          // доставался бы обрезанный ответ или пустота — а пустоту
          // застава отвергает, и разговор уходил бы человеку на ровном
          // месте. Консьержу размышление и не нужно: он отвечает
          // короткой справкой, а не решает задачу.
          thinking: { type: 'disabled' },
          system: renderSystem(request),
          messages: renderConversation(request.conversation),
        });

        return readAnswer(message);
      } catch (error) {
        /*
         * Молчание провайдера — рабочее состояние, а не авария: ядро
         * ответит клиенту человеком. Поэтому здесь запись в журнал, а не
         * исключение наружу.
         */
        console.error('Помощник не ответил:', error);
        return null;
      }
    },
  };
}

/**
 * Системная часть запроса: кто он, что знает и как просить человека.
 *
 * Одной строкой, а не тремя сообщениями: у совместимого эндпоинта
 * `system` — обычный текст, и раскладывать его по блокам с кэшированием
 * незачем — кэша у него нет.
 */
function renderSystem(request: ConciergeRequest): string {
  return [
    request.instructions,
    '',
    `Если нужно позвать менеджера или ответить не можешь — ответь одной строкой: ${HANDOVER_MARK}`,
    `Если сообщение не про обмен и не про сервис — ответь одной строкой: ${OFFTOPIC_MARK}`,
    '',
    '# Справка. Числа в ответе бывают только отсюда.',
    request.facts,
    ...(request.complaints && request.complaints.length > 0
      ? [
          '',
          '# Прошлый ответ не годится, исправь:',
          ...request.complaints.map((one) => `- ${one}`),
        ]
      : []),
  ].join('\n');
}

/**
 * Разговор в виде чередующихся ролей.
 *
 * Подряд идущие сообщения одной стороны склеиваются: клиент пишет три
 * подряд, и API ждёт от истории чередования. Пустой разговор здесь не
 * бывает — его начинает то самое сообщение, на которое отвечаем.
 */
function renderConversation(
  conversation: readonly ConciergeTurn[],
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const turn of conversation) {
    const role = turn.role === 'client' ? 'user' : 'assistant';
    const last = messages.at(-1);
    if (last?.role === role) {
      last.content = `${last.content as string}\n${turn.text}`;
      continue;
    }
    messages.push({ role, content: turn.text });
  }

  // Разговор обязан начинаться с клиента: ответ менеджера, оказавшийся
  // первым, API отвергает. Такое бывает у ленты, обрезанной по потолку.
  while (messages[0]?.role === 'assistant') {
    messages.shift();
  }

  return messages;
}

function readAnswer(message: Anthropic.Message): ConciergeAnswer {
  const reply = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  /*
   * Просьба считается по любой строке, а не только по первой. Ставить её
   * первой модели велено, но модель дешёвая и ставит где придётся: в
   * живом ответе она пришла хвостом после готового текста. Считанная по
   * первой строке, такая просьба проходила мимо — и слово «МЕНЕДЖЕР»
   * уезжало клиенту концом ответа.
   *
   * Строка целиком, а не вхождение в текст: «ответит менеджер» — это
   * обычная фраза, и на ней разговор уходил бы человеку всякий раз,
   * когда консьерж честно называет, кто ответит дальше.
   */
  const lines = reply.split('\n').map((line) => line.trim().toUpperCase());
  const needsHuman = lines.includes(HANDOVER_MARK);
  const offTopic = lines.includes(OFFTOPIC_MARK);

  return { reply, needsHuman, offTopic };
}

/**
 * Консьерж из переменных окружения. Ключа нет — нет и консьержа: это
 * рабочее состояние, при котором клиенту отвечает человек, как было до
 * него.
 */
export function conciergeFromEnvironment(): ConciergeSource | undefined {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return undefined;

  return createDeepSeekConcierge({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic',
    // Имя модели — свойство развёртывания: провайдер переименовывает их
    // чаще, чем выходит выкатка. По умолчанию младшая из двух, которые
    // провайдер называет поддерживаемыми (вторая — `deepseek-v4-pro`):
    // консьерж отвечает на вопросы поддержки, и старшая модель здесь
    // платится за то, чего от неё не просят.
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
  });
}
