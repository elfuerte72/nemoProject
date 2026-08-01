import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Проверка данных Telegram Login Widget — первый фактор входа менеджера.
 *
 * Подпись здесь строится иначе, чем у Mini App: секрет — это `SHA256`
 * от токена бота, а не `HMAC("WebAppData", token)`. Перепутать легко,
 * и тогда проверка либо всегда падает, либо (хуже) её пишут «помягче».
 *
 * Успешная проверка означает только «этим Telegram-аккаунтом владеет
 * тот, кто нажал кнопку». Права она не даёт: допуск выдаётся по списку
 * сотрудников, а затем требуется второй фактор.
 */

export class TelegramLoginError extends Error {}

/** Окно, в котором подпись входа считается свежей. */
const MAX_AGE_SECONDS = 5 * 60;

const loginSchema = z.object({
  id: z.coerce.number().int().positive(),
  auth_date: z.coerce.number().int().positive(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  photo_url: z.string().optional(),
});

export interface TelegramLogin {
  telegramUserId: bigint;
  username: string | undefined;
  authDate: Date;
}

/**
 * Разбор того, что прислал виджет.
 *
 * Значения приходят и строками, и числами — `id` и `auth_date` виджет
 * отдаёт числами, — а в строку проверки подписи они попадают как есть.
 * Поэтому привести их к строке нужно здесь, одинаково и заранее: от
 * порядка и формы этих значений зависит, сойдётся ли подпись.
 *
 * Вложенные объекты отвергаются: `${value}` превратил бы их в
 * «[object Object]», и подпись считалась бы от текста, которого Telegram
 * никогда не подписывал.
 */
const payloadSchema = z
  .record(z.union([z.string(), z.number()]))
  .transform((payload) =>
    Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [key, String(value)]),
    ),
  );

export function parseLoginPayload(input: unknown): Record<string, string> {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new TelegramLoginError('Данные входа непонятного вида');
  }
  return parsed.data;
}

export function verifyTelegramLogin(
  payload: Record<string, string>,
  botToken: string,
  now: Date = new Date(),
): TelegramLogin {
  const { hash, ...fields } = payload;
  if (!hash) {
    throw new TelegramLoginError('В данных входа нет подписи');
  }

  const dataCheckString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const actual = Buffer.from(hash, 'hex');

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new TelegramLoginError('Подпись входа не совпала');
  }

  const parsed = loginSchema.safeParse(fields);
  if (!parsed.success) {
    throw new TelegramLoginError('Не удалось разобрать данные входа');
  }

  const authDate = new Date(parsed.data.auth_date * 1000);
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > MAX_AGE_SECONDS) {
    throw new TelegramLoginError('Данные входа просрочены');
  }
  if (ageSeconds < -60) {
    throw new TelegramLoginError('auth_date из будущего');
  }

  return {
    telegramUserId: BigInt(parsed.data.id),
    username: parsed.data.username,
    authDate,
  };
}
