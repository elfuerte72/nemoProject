import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Сессия админ-панели.
 *
 * Хранится не в базе, а в подписанной строке со сроком годности: чем
 * заводить таблицу сессий, дешевле подписать идентификатор сотрудника
 * и время, до которого он действителен.
 *
 * Право доступа эта строка не подтверждает. Она говорит лишь «вход
 * состоялся тогда-то»; действует ли сотрудник до сих пор, проверяется
 * отдельно и при каждом запросе — иначе уволенный ходил бы по админке
 * до истечения выданной раньше сессии.
 */

export class SessionError extends Error {}

/**
 * Незавершённый вход — состояние между Telegram Login и одноразовым
 * кодом. Отдельная ступень, а не «сессия послабее»: подпись покрывает
 * и её, поэтому дописать себе полный доступ, поправив строку, нельзя.
 */
export type SessionStage = 'pending' | 'active';

export interface SessionPayload {
  readonly staffId: string;
  readonly stage: SessionStage;
}

export interface SessionOptions {
  readonly secret: string;
  readonly now?: Date;
  readonly ttlSeconds?: number;
}

/** Рабочий день менеджера: дольше сессия жить не должна. */
export const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
/** На ввод кода — пять минут, как и на свежесть подписи Telegram Login. */
export const PENDING_TTL_SECONDS = 5 * 60;

export const SESSION_COOKIE = 'nemo_admin_session';

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueToken(payload: SessionPayload, options: SessionOptions): string {
  const now = options.now ?? new Date();
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = Math.floor(now.getTime() / 1000) + ttl;

  const body = `${payload.staffId}.${payload.stage}.${expiresAt}`;
  return `${body}.${sign(body, options.secret)}`;
}

export function readToken(
  token: string | undefined,
  options: SessionOptions,
): SessionPayload {
  if (!token) {
    throw new SessionError('Нет сессии');
  }

  const parts = token.split('.');
  if (parts.length !== 4) {
    throw new SessionError('Сессия непонятного вида');
  }
  const [staffId, stage, expiresAt, signature] = parts as [string, string, string, string];

  const expected = Buffer.from(sign(`${staffId}.${stage}.${expiresAt}`, options.secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SessionError('Подпись сессии не совпала');
  }

  const now = options.now ?? new Date();
  if (Number(expiresAt) * 1000 <= now.getTime()) {
    throw new SessionError('Сессия истекла');
  }
  if (stage !== 'pending' && stage !== 'active') {
    throw new SessionError('Сессия непонятного вида');
  }

  return { staffId, stage };
}

export function sessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET не задан или короче 32 символов');
  }
  return secret;
}
