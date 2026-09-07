import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Сессия кабинета мерчанта.
 *
 * Устроена как сессия панели: подписанная строка со сроком годности, а
 * не запись в базе — чем заводить таблицу сессий, дешевле подписать
 * идентификатор и время, до которого он действителен.
 *
 * Отличие одно и важное: в подпись входит поколение
 * (`merchants.session_epoch`). Смена пароля увеличивает его в базе, и
 * все выданные раньше куки перестают подходить разом — не перебирая
 * их. Ради этого поколение и заведено: угнанный аккаунт мерчанта — это
 * кража у мерчанта, взломщик меняет реквизиты получателя, а платит
 * мерчант.
 *
 * Право доступа эта строка не подтверждает. Она говорит лишь «вход
 * состоялся тогда-то, при таком поколении»; одобрен ли мерчант и не
 * отключён ли, проверяется отдельно и при каждом запросе.
 */

export class SessionError extends Error {}

export interface SessionPayload {
  readonly merchantId: string;
  /** Поколение из `merchants.session_epoch` на момент входа. */
  readonly sessionEpoch: number;
}

export interface SessionOptions {
  readonly secret: string;
  readonly now?: Date;
  readonly ttlSeconds?: number;
}

/**
 * Тридцать суток. Дольше, чем у панели: там рабочий день сотрудника за
 * рабочим столом, а кабинет открывают раз в неделю — проверить заявку,
 * — и вход по паролю на каждый заход означал бы пароль, записанный в
 * браузере или на бумаге. Обрывается сессия сменой пароля, и это
 * быстрее любого срока.
 */
export const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

export const SESSION_COOKIE = 'tobee_cabinet_session';

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueToken(payload: SessionPayload, options: SessionOptions): string {
  const now = options.now ?? new Date();
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = Math.floor(now.getTime() / 1000) + ttl;

  const body = `${payload.merchantId}.${payload.sessionEpoch}.${expiresAt}`;
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
  const [merchantId, epoch, expiresAt, signature] = parts as [string, string, string, string];

  const expected = Buffer.from(sign(`${merchantId}.${epoch}.${expiresAt}`, options.secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SessionError('Подпись сессии не совпала');
  }

  const now = options.now ?? new Date();
  if (Number(expiresAt) * 1000 <= now.getTime()) {
    throw new SessionError('Сессия истекла');
  }

  const sessionEpoch = Number(epoch);
  if (!Number.isInteger(sessionEpoch) || sessionEpoch < 0) {
    throw new SessionError('Сессия непонятного вида');
  }

  return { merchantId, sessionEpoch };
}

export function sessionSecret(): string {
  const secret = process.env.CABINET_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('CABINET_SESSION_SECRET не задан или короче 32 символов');
  }
  return secret;
}

/** Свойства куки: одни на выдачу и на снятие, чтобы не разошлись. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: DEFAULT_TTL_SECONDS,
} as const;
