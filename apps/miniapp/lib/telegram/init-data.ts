import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Проверка `initData` — строки, которую Telegram передаёт Mini App при запуске.
 *
 * Это единственный рубеж авторизации клиента: `telegram_user_id` берётся
 * отсюда и больше ниоткуда. Клиент может подставить в запрос любой id,
 * поэтому доверять можно только тому, что подписано ботом.
 *
 * Подпись: `secret = HMAC-SHA256("WebAppData", bot_token)`, затем
 * `hash = HMAC-SHA256(secret, data_check_string)`, где строка проверки —
 * это пары `ключ=значение`, отсортированные по ключу и склеенные через `\n`.
 */

const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  language_code: z.string().optional(),
});

export interface InitData {
  telegramUserId: bigint;
  username: string | undefined;
  /** Полезная нагрузка из ссылки-приглашения, если запуск был по ней. */
  startParam: string | undefined;
  authDate: Date;
}

export class InitDataError extends Error {}

/** Насколько старой может быть подпись. Защита от повторного использования. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyInitData(
  raw: string,
  botToken: string,
  now: Date = new Date(),
): InitData {
  const params = new URLSearchParams(raw);

  const hash = params.get('hash');
  if (!hash) {
    throw new InitDataError('В initData нет подписи');
  }
  // Убирается только `hash`. Поле `signature` из строки проверки
  // исключает сторонняя проверка через Ed25519 — та, которой пользуется
  // не бот, а третья сторона; для проверки ботом по HMAC оно остаётся
  // обычным полем. Перепутать легко: `signature` появился позже, и
  // выглядит он как что-то, чего в подписи быть не должно. Ошибка при
  // этом не заметна на своих тестах и проявляется только на живом
  // Telegram, который это поле присылает.
  params.delete('hash');

  // Сортировка по ключу, а не по готовой строке «ключ=значение»: когда
  // один ключ — начало другого (`chat` и `chat_type` приходят вместе при
  // запуске из меню вложений), порядок расходится, потому что сравнение
  // упирается в `=` против следующей буквы ключа. Расхождение отвергает
  // подпись целиком, и только у части способов запуска.
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();

  const actual = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InitDataError('Подпись initData не совпала');
  }

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) {
    throw new InitDataError('В initData нет auth_date');
  }
  const authDate = new Date(Number(authDateRaw) * 1000);
  if (Number.isNaN(authDate.getTime())) {
    throw new InitDataError('Некорректный auth_date');
  }
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > MAX_AGE_SECONDS) {
    throw new InitDataError('initData просрочен');
  }
  if (ageSeconds < -60) {
    throw new InitDataError('auth_date из будущего');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new InitDataError('В initData нет пользователя');
  }
  const parsed = telegramUserSchema.safeParse(JSON.parse(userRaw));
  if (!parsed.success) {
    throw new InitDataError('Не удалось разобрать пользователя из initData');
  }

  return {
    telegramUserId: BigInt(parsed.data.id),
    username: parsed.data.username,
    startParam: params.get('start_param') ?? undefined,
    authDate,
  };
}
