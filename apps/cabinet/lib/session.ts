import { createHmac, timingSafeEqual } from 'node:crypto';
import { isCoreError } from '@nemo/http';

/**
 * Сессия кабинета мерчанта.
 *
 * Подписанная строка со сроком годности и номером записи о входе
 * (`merchant_sessions`). До 24 сентября 2026 записи не было, и вместо
 * номера в куке ехало поколение человека: оборвать сессию можно было
 * только все разом, сменой пароля. Теперь человек видит свои входы в
 * разделе «Сессии» и отключает незнакомое устройство по одному — а
 * поколение переехало в запись и по-прежнему обрывает все сессии разом
 * при смене пароля и закрытии доступа. Угнанный аккаунт мерчанта — это
 * кража у мерчанта: взломщик меняет реквизиты получателя, а платит
 * мерчант.
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
  /** Номер записи о входе: по нему сессию отключают и отмечают «это устройство». */
  readonly sessionId: string;
}

export interface SessionOptions {
  readonly secret: string;
  readonly now?: Date;
  readonly ttlSeconds?: number;
  /**
   * Срок из записи о входе. Задан — кука живёт ровно столько же, сколько
   * запись: разойдись они, кука пускала бы в истёкшую сессию до отказа
   * базы или выбрасывала бы из живой.
   */
  readonly expiresAt?: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const expiresAt = options.expiresAt
    ? Math.floor(options.expiresAt.getTime() / 1000)
    : Math.floor(now.getTime() / 1000) + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS);

  const body = `${payload.userId}.${payload.sessionId}.${expiresAt}`;
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
  const [userId, sessionId, expiresAt, signature] = parts as [string, string, string, string];

  const expected = Buffer.from(sign(`${userId}.${sessionId}.${expiresAt}`, options.secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SessionError('Подпись сессии не совпала');
  }

  const now = options.now ?? new Date();
  if (Number(expiresAt) * 1000 <= now.getTime()) {
    throw new SessionError('Сессия истекла');
  }

  // Кука до 24 сентября 2026 несла здесь поколение числом: подписана
  // она верно, но номера сессии в ней нет, и в базу с ней не ходят.
  if (!UUID.test(userId) || !UUID.test(sessionId)) {
    throw new SessionError('Сессия прежнего вида: войдите заново');
  }

  return { userId, sessionId };
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
