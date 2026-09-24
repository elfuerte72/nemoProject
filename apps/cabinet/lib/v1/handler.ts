import { randomUUID } from 'node:crypto';
import {
  addressAllowed,
  type Actor,
  type ApiKeyAuth,
  type ApiRequestLogInput,
  type CoreErrorCode,
} from '@nemo/core';
import { createAttemptCounter, isCoreError, json, statusForCoreError } from '@nemo/http';
import { addressOf, attemptAllowed, attemptSpent, UNKNOWN_ADDRESS } from '@/lib/attempts';
import { RATE_LIMITS, rateLimitHeaders, takeRateSlot } from './rate-limit';
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
 * (`invalid-input` → `invalid_input`), свои у адаптера пять:
 * `unauthorized`, `invalid_signature`, `rate_limited`,
 * `address_not_allowed` и `internal`.
 *
 * Каждый ответ несёт `x-request-id` — тот же, что ложится в журнал:
 * мерчант называет его поддержке, и строка находится без догадок о
 * времени. Ответ, где ключ действует и адрес разрешён, несёт ещё и
 * остаток предела (`x-ratelimit-*`): код мерчанта замедляется сам, не
 * дожидаясь 429. Отказ по ключу или адресу слота не тратит, и
 * остатка у него нет.
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
  | 'address_not_allowed'
  | 'internal';

function v1Code(code: CoreErrorCode): V1ErrorCode {
  return code.replace(/-/g, '_') as Underscored<CoreErrorCode>;
}

export function v1Error(status: number, code: V1ErrorCode, message: string, init?: ResponseInit) {
  return json({ error: { code, message } }, { ...init, status });
}

/**
 * Ответ с дописанными заголовками. Новый объект, а не правка старого:
 * заголовки ответа бывают неизменяемыми — у `Response.redirect` и у
 * ответа `fetch`, — и обработчик вправе вернуть любой.
 */
function withHeaders(response: Response, extra: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Отказы по адресу, записанные в журнал: не больше десятка за четверть
 * часа на пару «ключ и адрес». Укравший ключ зовёт с чужой машины и
 * получает 403, но каждый такой вызов — строка в журнале мерчанта, и без
 * потолка журнал рос бы по его воле. Запирать сам адрес счётчиком
 * нельзя: владелец добавит в список свой забытый сервер, а тот ещё
 * четверть часа ловил бы 429. Поэтому ограничена запись, а не ответ.
 */
const addressRefusals = createAttemptCounter({
  name: 'nemo.cabinet.address-refusals',
  limit: 10,
  windowMs: 15 * 60_000,
});

/** Забыть записанные отказы по адресу: нужно тестам. */
export function forgetAddressRefusals(): void {
  addressRefusals.forget();
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
  // Свой, а не присланный: чужой идентификатор мог бы совпасть с
  // другим вызовом или выдать себя за него в разговоре с поддержкой.
  const requestId = randomUUID();
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  // Путь — вместе со строкой запроса: так он и подписывается, и без неё
  // «GET /exchange-requests» в журнале не отличить от соседнего.
  const path = url.pathname + url.search;

  // Остаток предела известен после узнавания ключа; до него — пусто.
  let limitHeaders: Record<string, string> = {};
  const respond = (response: Response): Response =>
    withHeaders(response, { ...limitHeaders, 'x-request-id': requestId });

  const secret = secretOf(request);
  if (!secret) {
    return respond(
      v1Error(
        401,
        'unauthorized',
        'Нужен ключ API: заголовок Authorization: Bearer <ключ> или x-api-key',
      ),
    );
  }

  /*
   * Незнакомые ключи считаются по адресу тем же счётчиком, что попытки
   * входа: узнавание — чтение базы по хешу, и перебирать его со
   * скоростью сети нельзя. Считаются только неудачи: свой ключ с того
   * же адреса запирается лишь после десятка чужих — это уже перебор.
   */
  const address = addressOf(request);
  // Заглушка «неизвестный адрес» — не адрес: в журнал идёт пустота, иначе
  // она встала бы в «Откуда звали» с кнопкой «Разрешить».
  const knownAddress = address === UNKNOWN_ADDRESS ? null : address;
  if (!attemptAllowed(`api:${address}`)) {
    return respond(
      v1Error(429, 'rate_limited', 'Слишком много неверных ключей: попробуйте через четверть часа', {
        headers: { 'retry-after': '900' },
      }),
    );
  }

  const auth = await deps.authenticate(secret);
  if (!auth.ok && auth.reason === 'unknown') {
    attemptSpent(`api:${address}`);
    // Без записи и без подробностей: подробности помогли бы перебирать.
    return respond(v1Error(401, 'unauthorized', 'Ключ не подходит'));
  }

  const record = async (status: number, error: string | null, code: V1ErrorCode | null) => {
    try {
      await deps.log({
        merchantId: auth.merchantId,
        apiKeyId: auth.keyId,
        method,
        path,
        status,
        durationMs: performance.now() - started,
        address: knownAddress,
        error,
        errorCode: code,
        requestId,
      });
    } catch (failure) {
      // Журнал — не часть ответа: легшая запись не должна превращать
      // удачный вызов в пятисотый.
      console.error('Не удалось записать вызов API в журнал', failure);
    }
  };

  /** Отказ: записать в журнал и ответить тем же кодом и теми же словами. */
  const refuse = async (
    status: number,
    code: V1ErrorCode,
    message: string,
    init?: ResponseInit,
  ): Promise<Response> => {
    await record(status, message, code);
    return respond(v1Error(status, code, message, init));
  };

  if (!auth.ok) {
    return refuse(401, 'unauthorized', auth.message);
  }

  /*
   * Адрес сверяется до предела: вызов с чужой машины не должен тратить
   * вызовы настоящей интеграции — иначе укравший ключ, не пройдя сам,
   * запер бы её за минуту.
   */
  if (!addressAllowed(auth.allowedAddresses, address)) {
    const message = knownAddress
      ? `Вызовы с адреса ${knownAddress} не разрешены: список разрешённых адресов — в ` +
        'кабинете, раздел «API»'
      : 'Адрес вызова не определился, а список разрешённых адресов не пуст: вызов не ' +
        'принят. Список — в кабинете, раздел «API»';
    if (addressRefusals.reserve(`${auth.keyId}:${address}`) === null) {
      return respond(v1Error(403, 'address_not_allowed', message));
    }
    return refuse(403, 'address_not_allowed', message);
  }

  const slot = takeRateSlot(auth.keyId, deps.now().getTime());
  limitHeaders = rateLimitHeaders(slot.window);
  if (!slot.ok) {
    const message =
      `Слишком много вызовов: не больше ${RATE_LIMITS.perMinute} в минуту и ` +
      `${RATE_LIMITS.perHour} в час на ключ. Повторите через ${slot.retryAfterSeconds} с.`;
    return refuse(429, 'rate_limited', message, {
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
      path,
      body,
      timestamp: request.headers.get('x-timestamp'),
      signature: request.headers.get('x-signature'),
      now: deps.now(),
      seen: seenSignatures(),
    });
    if (!check.ok) {
      return refuse(401, 'invalid_signature', check.message);
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
    await record(response.status, null, null);
    return respond(response);
  } catch (error) {
    if (isCoreError(error)) {
      return refuse(statusForCoreError(error.code), v1Code(error.code), error.message);
    }
    // Наружу — ничего, кроме факта: в сообщении может оказаться что
    // угодно, вплоть до строки подключения к базе.
    console.error('Вызов API v1 упал', error);
    return refuse(
      500,
      'internal',
      'Внутренняя ошибка: повторите позже, а если не проходит — напишите в поддержку',
    );
  }
}
