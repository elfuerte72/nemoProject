import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Подпись HMAC запроса к API — по желанию мерчанта, но включённая
 * обязательна для каждого вызова.
 *
 * Ключ API в заголовке уже удостоверяет мерчанта; подпись добавляет то,
 * чего заголовок не даёт: запрос, перехваченный по дороге, нельзя ни
 * изменить, ни повторить. Подписывается метод, путь, отметка времени и
 * хеш тела — тем же ключом, что и в заголовке: второго секрета у
 * мерчанта нет, и заводить его ради подписи значило бы хранить два.
 *
 * Устройство как у Love&Pay (spec, «API v1»): `x-api-key`,
 * `x-timestamp`, `x-signature`. Строка для подписи собрана через
 * перевод строки, а не склеена: без разделителя «/a» + «1» и «/a1» + «»
 * подписывались бы одинаково.
 */

/** Сколько живёт отметка времени — в обе стороны: часы бывают спешащими. */
export const SIGNATURE_WINDOW_MS = 5 * 60_000;

export interface SignedRequest {
  readonly method: string;
  /** Путь вместе со строкой запроса — как он ушёл в сеть. */
  readonly path: string;
  /** Тело как строка; у GET — пустая. */
  readonly body: string;
  /** Unix-время в секундах, строкой — так оно едет в заголовке. */
  readonly timestamp: string;
}

export function bodyDigest(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

export function canonicalString(request: SignedRequest): string {
  return [request.method.toUpperCase(), request.path, request.timestamp, bodyDigest(request.body)]
    .join('\n');
}

/** Подпись — шестнадцатеричным HMAC-SHA256. Ею же подписывает пример в документации. */
export function signRequest(secret: string, request: SignedRequest): string {
  return createHmac('sha256', secret).update(canonicalString(request)).digest('hex');
}

export type SignatureCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'missing' | 'stale' | 'mismatch' | 'replayed';
      readonly message: string;
    };

/**
 * Подписи, которые уже видели, — чтобы перехваченный запрос не прошёл
 * второй раз внутри окна. В памяти процесса: подпись живёт пять минут,
 * и таблица в базе ради этого — запись на каждый вызов.
 *
 * Просроченные забываются при записи, а не по таймеру: писать сюда
 * может только тот, кто уже прошёл проверку ключа, и рост памяти
 * ограничен его же лимитом вызовов.
 */
export class SeenSignatures {
  private readonly seen = new Map<string, number>();

  has(signature: string, now: Date): boolean {
    const until = this.seen.get(signature);
    return until !== undefined && until > now.getTime();
  }

  remember(signature: string, now: Date): void {
    this.sweep(now);
    // Помнится вдвое дольше окна: подпись с отметкой из будущего иначе
    // забылась бы раньше, чем перестала быть свежей.
    this.seen.set(signature, now.getTime() + SIGNATURE_WINDOW_MS * 2);
  }

  get size(): number {
    return this.seen.size;
  }

  private sweep(now: Date): void {
    for (const [signature, until] of this.seen) {
      if (until <= now.getTime()) this.seen.delete(signature);
    }
  }
}

export function verifySignature(input: {
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly timestamp: string | null;
  readonly signature: string | null;
  readonly now: Date;
  readonly seen: SeenSignatures;
}): SignatureCheck {
  if (!input.timestamp || !input.signature) {
    return {
      ok: false,
      code: 'missing',
      message:
        'Для этого ключа подпись обязательна: заголовки x-timestamp и x-signature — ' +
        'см. раздел «API» в кабинете',
    };
  }

  const seconds = Number(input.timestamp);
  if (!Number.isFinite(seconds) || !/^\d+$/.test(input.timestamp)) {
    return {
      ok: false,
      code: 'missing',
      message: 'x-timestamp — Unix-время в секундах, целым числом',
    };
  }

  const skew = Math.abs(input.now.getTime() - seconds * 1000);
  if (skew > SIGNATURE_WINDOW_MS) {
    return {
      ok: false,
      code: 'stale',
      message: 'Отметка времени старше пяти минут: проверьте часы и подпишите заново',
    };
  }

  const expected = Buffer.from(
    signRequest(input.secret, {
      method: input.method,
      path: input.path,
      body: input.body,
      timestamp: input.timestamp,
    }),
  );
  const actual = Buffer.from(input.signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return {
      ok: false,
      code: 'mismatch',
      message:
        'Подпись не сходится: подписываются метод, путь со строкой запроса, ' +
        'x-timestamp и SHA-256 тела через перевод строки',
    };
  }

  if (input.seen.has(input.signature, input.now)) {
    return {
      ok: false,
      code: 'replayed',
      message: 'Эта подпись уже была: каждый запрос подписывается заново',
    };
  }
  input.seen.remember(input.signature, input.now);

  return { ok: true };
}
