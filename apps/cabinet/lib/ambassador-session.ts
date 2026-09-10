import { createHmac, timingSafeEqual } from 'node:crypto';
import { SessionError, type SessionOptions, DEFAULT_TTL_SECONDS } from './session';

/**
 * Сессия кабинета амбассадора — вторая кука рядом с мерчантской.
 *
 * Выделка та же: подписанная строка со сроком, а не запись в базе.
 * Отличий два. Своё имя куки — иначе вход в один кабинет выбрасывал бы
 * из другого, а у мерчанта и амбассадора это разные люди, изредка
 * работающие с одной машины. И нет поколения: менять пароль
 * амбассадору нечего, а гасится доступ снятием отметки — ядро
 * проверяет её при каждом запросе (`signInAmbassador`).
 *
 * Право эта строка не подтверждает и здесь: она говорит лишь «вход
 * состоялся тогда-то».
 */

export const AMBASSADOR_COOKIE = 'tobee_ambassador_session';

export interface AmbassadorSessionPayload {
  readonly clientId: bigint;
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueAmbassadorToken(
  payload: AmbassadorSessionPayload,
  options: SessionOptions,
): string {
  const now = options.now ?? new Date();
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = Math.floor(now.getTime() / 1000) + ttl;

  const body = `${payload.clientId}.${expiresAt}`;
  return `${body}.${sign(body, options.secret)}`;
}

export function readAmbassadorToken(
  token: string | undefined,
  options: SessionOptions,
): AmbassadorSessionPayload {
  if (!token) {
    throw new SessionError('Нет сессии');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new SessionError('Сессия непонятного вида');
  }
  const [clientId, expiresAt, signature] = parts as [string, string, string];

  const expected = Buffer.from(sign(`${clientId}.${expiresAt}`, options.secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SessionError('Подпись сессии не совпала');
  }

  const now = options.now ?? new Date();
  if (Number(expiresAt) * 1000 <= now.getTime()) {
    throw new SessionError('Сессия истекла');
  }

  // Идентификатор клиента — целое: за ним чужой счёт, и «седьмой»
  // вместо числа должен быть отказом, а не запросом в базу с мусором.
  if (!/^\d{1,19}$/.test(clientId)) {
    throw new SessionError('Сессия непонятного вида');
  }

  return { clientId: BigInt(clientId) };
}

/** Свойства куки: одни на выдачу и на снятие, чтобы не разошлись. */
export const AMBASSADOR_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: DEFAULT_TTL_SECONDS,
} as const;
