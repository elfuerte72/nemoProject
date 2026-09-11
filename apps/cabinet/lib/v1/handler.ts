import type { Actor, ApiKeyAuth, ApiRequestLogInput, CoreErrorCode } from '@nemo/core';
import { isCoreError, json, statusForCoreError } from '@nemo/http';
import { addressOf, attemptAllowed, attemptSpent } from '@/lib/attempts';
import { RATE_LIMITS, takeRateSlot } from './rate-limit';
import { SeenSignatures, verifySignature } from './signature';

/**
 * Обёртка маршрута API v1: узнать ключ, проверить предел и подпись,
 * позвать обработчик, записать вызов в журнал.
 *
 * Обработчик получает того же `Actor`, что и кабинет: ядро не знает,
 * откуда пришёл запрос, и права решает само. Здесь только адаптер —
 * кто пришёл и что ответить на отказ.
 *
 * Тело ошибки — договор с мерчантом: `{ error: { code, message } }`,
 * код машинный, слова человеку. Коды ядра переводятся один к одному
 * (`invalid-input` → `invalid_input`), свои у адаптера три:
 * `unauthorized`, `invalid_signature`, `rate_limited`.
 *
 * В журнал пишется каждый вызов с узнанным ключом, включая отвергнутый:
 * «401 по отозванному ключу» отвечает мерчанту, почему встала
 * интеграция. Вызов с незнакомым ключом ничей и не пишется — иначе
 * место в журнале доставалось бы перебирающему.
 *
 * Ядро приходит зависимостью, а не импортом: так обёртка проверяется
 * без базы, а маршрут подставляет настоящее ядро одной строкой.
 */

export type MerchantActor = Actor & { readonly type: 'merchant' };

export interface V1Context {
  readonly actor: MerchantActor;
  readonly keyId: string;
}

export type V1Handler = (request: Request, ctx: V1Context, body: string) => Promise<Response>;

export interface V1Deps {
  readonly authenticate: (secret: string) => Promise<ApiKeyAuth>;
  readonly log: (entry: ApiRequestLogInput) => Promise<void>;
  readonly now: () => Date;
}

/** Код ядра в машинном виде договора: дефис — подчёркиванием. */
type Underscored<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}_${Underscored<Tail>}`
  : S;

export type V1ErrorCode =
  | Underscored<CoreErrorCode>
  | 'unauthorized'
  | 'invalid_signature'
  | 'rate_limited'
  | 'internal';

function v1Code(code: CoreErrorCode): V1ErrorCode {
  return code.replace(/-/g, '_') as Underscored<CoreErrorCode>;
}

export function v1Error(status: number, code: V1ErrorCode, message: string, init?: ResponseInit) {
  return json({ error: { code, message } }, { ...init, status });
}

/** Подписи, которые уже видели, — одни на процесс, как и пределы. */
const SEEN_KEY = Symbol.for('nemo.cabinet.seen-signatures');
type Holder = typeof globalThis & { [SEEN_KEY]?: SeenSignatures };

function seenSignatures(): SeenSignatures {
  const holder = globalThis as Holder;
  holder[SEEN_KEY] ??= new SeenSignatures();
  return holder[SEEN_KEY];
}

/** Забыть виденные подписи: нужно тестам, которым иначе мешает предыдущий. */
export function forgetSeenSignatures(): void {
  (globalThis as Holder)[SEEN_KEY] = new SeenSignatures();
}

/** Ключ — из `Authorization: Bearer` или из `x-api-key`: оба в ходу у интеграций. */
function secretOf(request: Request): string | null {
  const bearer = request.headers.get('authorization');
  if (bearer?.toLowerCase().startsWith('bearer ')) {
    const secret = bearer.slice(7).trim();
    if (secret) return secret;
  }
  const header = request.headers.get('x-api-key')?.trim();
  return header || null;
}

export async function handleV1(
  request: Request,
  handler: V1Handler,
  deps: V1Deps,
): Promise<Response> {
  const started = performance.now();
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;

  const secret = secretOf(request);
  if (!secret) {
    return v1Error(
      401,
      'unauthorized',
      'Нужен ключ API: заголовок Authorization: Bearer <ключ> или x-api-key',
    );
  }

  /*
   * Незнакомые ключи считаются по адресу тем же счётчиком, что попытки
   * входа: узнавание — чтение базы по хешу, и перебирать его со
   * скоростью сети нельзя. Считаются только неудачи: свой ключ с того
   * же адреса запирается лишь после десятка чужих — это уже перебор.
   */
  const address = addressOf(request);
  if (!attemptAllowed(`api:${address}`)) {
    return v1Error(429, 'rate_limited', 'Слишком много неверных ключей: попробуйте через четверть часа', {
      headers: { 'retry-after': '900' },
    });
  }

  const auth = await deps.authenticate(secret);
  if (!auth.ok && auth.reason === 'unknown') {
    attemptSpent(`api:${address}`);
    // Без записи и без подробностей: подробности помогли бы перебирать.
    return v1Error(401, 'unauthorized', 'Ключ не подходит');
  }

  const record = async (status: number, error: string | null): Promise<void> => {
    try {
      await deps.log({
        merchantId: auth.merchantId,
        apiKeyId: auth.keyId,
        method,
        path,
        status,
        durationMs: performance.now() - started,
        address,
        error,
      });
    } catch (failure) {
      // Журнал — не часть ответа: легшая запись не должна превращать
      // удачный вызов в пятисотый.
      console.error('Не удалось записать вызов API в журнал', failure);
    }
  };

  if (!auth.ok) {
    await record(401, auth.message);
    return v1Error(401, 'unauthorized', auth.message);
  }

  const slot = takeRateSlot(auth.keyId, deps.now().getTime());
  if (!slot.ok) {
    const message =
      `Слишком много вызовов: не больше ${RATE_LIMITS.perMinute} в минуту и ` +
      `${RATE_LIMITS.perHour} в час на ключ. Повторите через ${slot.retryAfterSeconds} с.`;
    await record(429, message);
    return v1Error(429, 'rate_limited', message, {
      headers: { 'retry-after': String(slot.retryAfterSeconds) },
    });
  }

  // Тело читается здесь один раз: оно нужно и подписи, и обработчику,
  // а поток запроса читается однажды.
  const body = method === 'GET' || method === 'HEAD' ? '' : await request.text();

  if (auth.signatureRequired) {
    const check = verifySignature({
      secret,
      method,
      path: url.pathname + url.search,
      body,
      timestamp: request.headers.get('x-timestamp'),
      signature: request.headers.get('x-signature'),
      now: deps.now(),
      seen: seenSignatures(),
    });
    if (!check.ok) {
      await record(401, check.message);
      return v1Error(401, 'invalid_signature', check.message);
    }
  }

  const ctx: V1Context = {
    /*
     * Ключ действует как оператор и ничей: он принадлежит организации,
     * а не человеку (тикет 17). Отсюда два следствия — ключом нельзя
     * вести ключи, вебхуки и людей, и заявка по нему остаётся без
     * автора: назвать им того, кто ключ выпустил, значило бы записать
     * в историю чужую работу.
     */
    actor: { type: 'merchant', merchantId: auth.merchantId, role: 'operator', userId: null },
    keyId: auth.keyId,
  };

  try {
    const response = await handler(request, ctx, body);
    await record(response.status, null);
    return response;
  } catch (error) {
    if (isCoreError(error)) {
      const status = statusForCoreError(error.code);
      await record(status, error.message);
      return v1Error(status, v1Code(error.code), error.message);
    }
    // Наружу — ничего, кроме факта: в сообщении может оказаться что
    // угодно, вплоть до строки подключения к базе.
    console.error('Вызов API v1 упал', error);
    const message = 'Внутренняя ошибка: повторите позже, а если не проходит — напишите в поддержку';
    await record(500, message);
    return v1Error(500, 'internal', message);
  }
}
