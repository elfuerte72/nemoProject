import { createHmac, timingSafeEqual } from 'node:crypto';
import { isCoreError } from '@nemo/http';

/**
 * Сессия кабинета мерчанта.
 *
 * Устроена как сессия панели: подписанная строка со сроком годности, а
 * не запись в базе — чем заводить таблицу сессий, дешевле подписать
 * идентификатор и время, до которого он действителен.
 *
 * Отличие одно и важное: в подпись входит поколение
 * (`merchant_users.session_epoch`). Смена пароля и закрытие доступа
 * увеличивают его в базе, и все выданные раньше куки перестают
 * подходить разом — не перебирая их. Ради этого поколение и заведено:
 * угнанный аккаунт мерчанта — это кража у мерчанта, взломщик меняет
 * реквизиты получателя, а платит мерчант.
 *
 * Право доступа эта строка не подтверждает. Она говорит лишь «вход
 * состоялся тогда-то, при таком поколении»; одобрен ли мерчант и не
 * отключён ли, проверяется отдельно и при каждом запросе.
 */

export class SessionError extends Error {}

/**
 * Отказ, который означает «нужно войти»: сессии нет или она не читается,
 * либо ядро не признало её — поколение сменилось или мерчанта больше
 * нет. Отказ ядра узнаётся по коду, а не по классу: в `next dev` у
 * маршрута и у ядра разные копии класса (см. `isCoreError`).
 */
export function isSignedOut(error: unknown): boolean {
  return error instanceof SessionError || (isCoreError(error) && error.code === 'forbidden');
}

/**
 * Чтение сессии для страницы: без сессии — не ошибка, а то, что скажет
 * вызывающий: разделам кабинета — на вход, странице входа — `null`.
 *
 * Каркас кабинета и раздел под ним — два серверных компонента, и Next
 * рисует их параллельно. Пока каркас делал редирект, раздел успевал
 * бросить отказ чтения: посетитель получал свой 307, а в журнал
 * контейнера на каждый заход без сессии ложилась «ошибка» — в тот
 * журнал, где ищут настоящие поломки. Поэтому на вход уходит само
 * чтение, и уходит одинаково из любого компонента.
 *
 * Куда именно уходить, решает вызывающий: `redirect` из Next бросает
 * своё исключение, и здесь его знать незачем — так помощник проверяется
 * без Next.
 */
export async function viewerOrElse<T, F>(
  read: () => Promise<T>,
  onSignedOut: () => F,
): Promise<T | F> {
  try {
    return await read();
  } catch (error) {
    if (isSignedOut(error)) return onSignedOut();
    throw error;
  }
}

export interface SessionPayload {
  /**
   * Кто вошёл — человек, а не организация: людей у мерчанта несколько
   * (тикет 17), и какой из них подал заявку, кабинет обязан знать.
   * Своего мерчанта человек приносит с собой — он записан у него в
   * строке, и подделать его в куке нечем.
   */
  readonly userId: string;
  /** Поколение из `merchant_users.session_epoch` на момент входа. */
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

  const body = `${payload.userId}.${payload.sessionEpoch}.${expiresAt}`;
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
  const [userId, epoch, expiresAt, signature] = parts as [string, string, string, string];

  const expected = Buffer.from(sign(`${userId}.${epoch}.${expiresAt}`, options.secret));
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

  return { userId, sessionEpoch };
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
