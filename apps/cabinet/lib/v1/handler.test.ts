import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidInputError, type ApiKeyAuth } from '@nemo/core';
import { ATTEMPT_LIMIT, forgetAttempts } from '@/lib/attempts';
import { forgetRateLimits, RATE_LIMITS } from './rate-limit';
import { forgetAddressRefusals, forgetSeenSignatures, handleV1, type V1Deps } from './handler';
import { signRequest } from './signature';

/**
 * Обёртка маршрута API: кто пришёл, можно ли ему, что ответить на отказ
 * и что записать в журнал.
 *
 * Ядро здесь подменено: проверяется адаптер, а не операции. Тело ошибки
 * — договор с мерчантом, и его вид закреплён тестом: код машинный,
 * слова человеку.
 */

const secret = 'sk_test_' + 'a'.repeat(32);
const KEY_ID = '11111111-1111-1111-1111-111111111111';
const MERCHANT_ID = '22222222-2222-2222-2222-222222222222';

const OK: ApiKeyAuth = {
  ok: true,
  merchantId: MERCHANT_ID,
  keyId: KEY_ID,
  signatureRequired: false,
  allowedAddresses: [],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function deps(auth: ApiKeyAuth = OK): V1Deps & { log: ReturnType<typeof vi.fn> } {
  return {
    authenticate: vi.fn(async () => auth),
    log: vi.fn(async () => undefined),
    now: () => new Date('2026-09-07T10:00:00Z'),
  };
}

function request(init: RequestInit & { path?: string; key?: string | null } = {}): Request {
  const { path = '/api/v1/rates', key = secret, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (key !== null) headers.set('authorization', `Bearer ${key}`);
  return new Request(`https://cabinet.example${path}`, { ...rest, headers });
}

async function body(response: Response): Promise<unknown> {
  return response.json();
}

beforeEach(() => {
  forgetRateLimits();
  forgetSeenSignatures();
  forgetAttempts();
  forgetAddressRefusals();
});

describe('кто пришёл', () => {
  it('без ключа — 401, и в журнал такое не пишется: вызов ничей', async () => {
    const d = deps();
    const response = await handleV1(request({ key: null }), async () => Response.json({}), d);

    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({
      error: { code: 'unauthorized', message: expect.stringContaining('Authorization') },
    });
    expect(d.authenticate).not.toHaveBeenCalled();
    expect(d.log).not.toHaveBeenCalled();
  });

  it('незнакомый ключ — 401 без подробностей и без записи', async () => {
    const d = deps({ ok: false, reason: 'unknown' });
    const response = await handleV1(request(), async () => Response.json({}), d);

    expect(response.status).toBe(401);
    expect(d.log).not.toHaveBeenCalled();
  });

  it('отозванный ключ — 401 словами, и это записано мерчанту в журнал', async () => {
    const d = deps({
      ok: false,
      reason: 'revoked',
      merchantId: MERCHANT_ID,
      keyId: KEY_ID,
      message: 'Ключ отозван: выпустите новый в кабинете',
    });
    const response = await handleV1(request(), async () => Response.json({}), d);

    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({
      error: { code: 'unauthorized', message: 'Ключ отозван: выпустите новый в кабинете' },
    });
    expect(d.log).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: MERCHANT_ID,
        apiKeyId: KEY_ID,
        method: 'GET',
        path: '/api/v1/rates',
        status: 401,
        error: 'Ключ отозван: выпустите новый в кабинете',
      }),
    );
  });

  /** Перебор ключей — чтение базы по хешу на каждый; с одного адреса он запирается. */
  it('десяток незнакомых ключей с одного адреса — 429 на четверть часа', async () => {
    const d = deps({ ok: false, reason: 'unknown' });
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) {
      expect((await handleV1(request({ headers }), async () => Response.json({}), d)).status).toBe(401);
    }
    const locked = await handleV1(request({ headers }), async () => Response.json({}), d);
    expect(locked.status).toBe(429);
    expect(d.authenticate).toHaveBeenCalledTimes(ATTEMPT_LIMIT);
    // Другой адрес не заперт.
    expect(
      (await handleV1(request({ headers: { 'x-forwarded-for': '203.0.113.10' } }), async () => Response.json({}), d)).status,
    ).toBe(401);
  });

  it('ключ принимается и из x-api-key', async () => {
    const d = deps();
    const response = await handleV1(
      request({ key: null, headers: { 'x-api-key': secret } }),
      async () => Response.json({ ok: true }),
      d,
    );
    expect(response.status).toBe(200);
    expect(d.authenticate).toHaveBeenCalledWith(secret);
  });
});

describe('удачный вызов', () => {
  it('отдаёт ответ обработчика и пишет его в журнал с длительностью', async () => {
    const d = deps();
    const response = await handleV1(
      request(),
      async (_request, ctx) => Response.json({ merchant: ctx.actor.merchantId }),
      d,
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ merchant: MERCHANT_ID });
    expect(d.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, error: null, durationMs: expect.any(Number) }),
    );
  });

  it('адрес вызывающего берётся из x-forwarded-for', async () => {
    const d = deps();
    await handleV1(
      request({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }),
      async () => Response.json({}),
      d,
    );
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ address: '203.0.113.7' }));
  });
});

describe('отказы', () => {
  it('отказ ядра — его код и его слова', async () => {
    const d = deps();
    const response = await handleV1(
      request(),
      async () => {
        throw new InvalidInputError('Минимальная сумма обмена — 35 USDT');
      },
      d,
    );

    expect(response.status).toBe(422);
    expect(await body(response)).toEqual({
      error: { code: 'invalid_input', message: 'Минимальная сумма обмена — 35 USDT' },
    });
    expect(d.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 422, error: 'Минимальная сумма обмена — 35 USDT' }),
    );
  });

  it('непредвиденное — 500 без подробностей наружу', async () => {
    const d = deps();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleV1(
      request(),
      async () => {
        throw new Error('connection refused: postgres://nemo:secret@db');
      },
      d,
    );
    spy.mockRestore();

    expect(response.status).toBe(500);
    const said = (await body(response)) as { error: { code: string; message: string } };
    expect(said.error.code).toBe('internal');
    expect(said.error.message).not.toContain('postgres');
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
  });

  it('сверх лимита — 429 с retry-after, и это тоже в журнале', async () => {
    const d = deps();
    for (let i = 0; i < RATE_LIMITS.perMinute; i += 1) {
      await handleV1(request(), async () => Response.json({}), d);
    }
    const response = await handleV1(request(), async () => Response.json({}), d);

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await body(response)).toEqual({
      error: { code: 'rate_limited', message: expect.stringContaining('минуту') },
    });
    expect(d.log).toHaveBeenLastCalledWith(expect.objectContaining({ status: 429 }));
  });

  it('сбой записи в журнал ответа не портит', async () => {
    const d = deps();
    d.log.mockRejectedValueOnce(new Error('база легла'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleV1(request(), async () => Response.json({ ok: 1 }), d);
    spy.mockRestore();

    expect(response.status).toBe(200);
  });
});

describe('подпись, когда мерчант её включил', () => {
  const signedDeps = () => deps({ ...OK, signatureRequired: true });
  const now = new Date('2026-09-07T10:00:00Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));

  function signedRequest(payload: string, path = '/api/v1/quote'): Request {
    const signature = signRequest(secret, { method: 'POST', path, body: payload, timestamp });
    return request({
      path,
      method: 'POST',
      body: payload,
      headers: {
        'content-type': 'application/json',
        'x-timestamp': timestamp,
        'x-signature': signature,
      },
    });
  }

  it('без подписи — 401 своим кодом, чтобы мерчант понял, чего не хватает', async () => {
    const d = signedDeps();
    const response = await handleV1(
      request({ method: 'POST', body: '{}' }),
      async () => Response.json({}),
      d,
    );

    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({
      error: { code: 'invalid_signature', message: expect.stringContaining('x-signature') },
    });
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });

  it('с верной подписью проходит, и тело доходит до обработчика нетронутым', async () => {
    const d = signedDeps();
    const payload = '{"from":"USDT","to":"RUB","amount":"100"}';
    const response = await handleV1(
      signedRequest(payload),
      async (_request, _ctx, raw) => Response.json({ raw }),
      d,
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ raw: payload });
  });

  it('повтор той же подписи не проходит', async () => {
    const d = signedDeps();
    const payload = '{"from":"USDT","to":"RUB","amount":"100"}';
    expect((await handleV1(signedRequest(payload), async () => Response.json({}), d)).status).toBe(
      200,
    );
    const again = await handleV1(signedRequest(payload), async () => Response.json({}), d);
    expect(again.status).toBe(401);
    expect(await body(again)).toMatchObject({ error: { code: 'invalid_signature' } });
  });

  it('подпись под другим телом не принимается', async () => {
    const d = signedDeps();
    const signature = signRequest(secret, {
      method: 'POST',
      path: '/api/v1/quote',
      body: '{"amount":"1"}',
      timestamp,
    });
    const response = await handleV1(
      request({
        path: '/api/v1/quote',
        method: 'POST',
        body: '{"amount":"1000000"}',
        headers: { 'x-timestamp': timestamp, 'x-signature': signature },
      }),
      async () => Response.json({}),
      d,
    );
    expect(response.status).toBe(401);
  });
});

describe('идентификатор запроса', () => {
  it('стоит на каждом ответе — и на отказе без ключа', async () => {
    const response = await handleV1(request({ key: null }), async () => Response.json({}), deps());
    expect(response.headers.get('x-request-id')).toMatch(UUID);
  });

  it('тот же, что записан в журнал: по нему поддержка находит строку', async () => {
    const d = deps();
    const response = await handleV1(request(), async () => Response.json({}), d);
    const id = response.headers.get('x-request-id');
    expect(id).toMatch(UUID);
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ requestId: id }));
  });

  it('у каждого вызова свой', async () => {
    const d = deps();
    const first = await handleV1(request(), async () => Response.json({}), d);
    const second = await handleV1(request(), async () => Response.json({}), d);
    expect(first.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'));
  });
});

describe('заголовки предела', () => {
  it('удачный ответ несёт остаток в минуте и в часе', async () => {
    const response = await handleV1(request(), async () => Response.json({}), deps());
    expect(response.headers.get('x-ratelimit-limit-minute')).toBe(String(RATE_LIMITS.perMinute));
    expect(response.headers.get('x-ratelimit-remaining-minute')).toBe(
      String(RATE_LIMITS.perMinute - 1),
    );
    expect(response.headers.get('x-ratelimit-remaining-hour')).toBe(String(RATE_LIMITS.perHour - 1));
    expect(response.headers.get('x-ratelimit-reset')).toBe('2026-09-07T10:01:00.000Z');
  });

  it('отказ ядра их тоже несёт: вызов потрачен', async () => {
    const response = await handleV1(
      request(),
      async () => {
        throw new InvalidInputError('нет');
      },
      deps(),
    );
    expect(response.headers.get('x-ratelimit-remaining-minute')).toBe(
      String(RATE_LIMITS.perMinute - 1),
    );
  });

  it('на 429 остаток — ноль', async () => {
    const d = deps();
    for (let i = 0; i < RATE_LIMITS.perMinute; i += 1) {
      await handleV1(request(), async () => Response.json({}), d);
    }
    const response = await handleV1(request(), async () => Response.json({}), d);
    expect(response.status).toBe(429);
    expect(response.headers.get('x-ratelimit-remaining-minute')).toBe('0');
  });
});

describe('журнал знает машинный код отказа и строку запроса', () => {
  it('код ядра — тем же словом, что в теле', async () => {
    const d = deps();
    await handleV1(
      request(),
      async () => {
        throw new InvalidInputError('Минимальная сумма');
      },
      d,
    );
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'invalid_input' }));
  });

  it('у удачного кода нет', async () => {
    const d = deps();
    await handleV1(request(), async () => Response.json({}), d);
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ errorCode: null }));
  });

  it('у отозванного ключа — unauthorized', async () => {
    const d = deps({
      ok: false,
      reason: 'revoked',
      merchantId: MERCHANT_ID,
      keyId: KEY_ID,
      message: 'Ключ отозван',
    });
    await handleV1(request(), async () => Response.json({}), d);
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'unauthorized' }));
  });

  it('путь пишется со строкой запроса: без неё «GET /exchange-requests» не разобрать', async () => {
    const d = deps();
    await handleV1(
      request({ path: '/api/v1/exchange-requests?limit=5&status=paid' }),
      async () => Response.json({}),
      d,
    );
    expect(d.log).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/v1/exchange-requests?limit=5&status=paid' }),
    );
  });
});

describe('разрешённые адреса', () => {
  const guarded = () => deps({ ...OK, allowedAddresses: ['203.0.113.0/24'] });

  it('с адреса из списка вызов проходит', async () => {
    const response = await handleV1(
      request({ headers: { 'x-forwarded-for': '203.0.113.50' } }),
      async () => Response.json({ ok: true }),
      guarded(),
    );
    expect(response.status).toBe(200);
  });

  it('с чужого — 403 своим кодом, адрес назван, и это в журнале мерчанта', async () => {
    const d = guarded();
    const handler = vi.fn(async () => Response.json({}));
    const response = await handleV1(
      request({ headers: { 'x-forwarded-for': '198.51.100.9' } }),
      handler,
      d,
    );

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({
      error: { code: 'address_not_allowed', message: expect.stringContaining('198.51.100.9') },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403, errorCode: 'address_not_allowed', address: '198.51.100.9' }),
    );
  });

  it('отвергнутый по адресу вызов предела своего ключа не тратит', async () => {
    const d = guarded();
    await handleV1(
      request({ headers: { 'x-forwarded-for': '198.51.100.9' } }),
      async () => Response.json({}),
      d,
    );
    const next = await handleV1(
      request({ headers: { 'x-forwarded-for': '203.0.113.50' } }),
      async () => Response.json({}),
      d,
    );
    expect(next.headers.get('x-ratelimit-remaining-minute')).toBe(
      String(RATE_LIMITS.perMinute - 1),
    );
  });

  it('без адреса в заголовках при непустом списке — отказ: пускать неизвестно кого незачем', async () => {
    const d = guarded();
    const response = await handleV1(request(), async () => Response.json({}), d);
    expect(response.status).toBe(403);
    // Заглушка «неизвестный адрес» — не адрес: в журнал и в слова отказа
    // она не идёт, иначе встала бы в «Откуда звали» с кнопкой «Разрешить».
    expect(((await body(response)) as { error: { message: string } }).error.message).not.toMatch(
      /неизвестный/,
    );
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ address: null }));
  });

  /*
   * Укравший ключ зовёт с чужой машины и получает 403 — но каждый такой
   * вызов строка в журнале мерчанта. Запирать адрес счётчиком нельзя:
   * владелец добавит в список свой забытый сервер, а тот ещё четверть
   * часа ловил бы 429. Поэтому ограничена запись, а не ответ.
   */
  it('после десятка отказов с одного адреса за четверть часа новые не пишутся, ответ тот же', async () => {
    const d = guarded();
    const headers = { 'x-forwarded-for': '198.51.100.9' };
    for (let i = 0; i < 12; i += 1) {
      const response = await handleV1(request({ headers }), async () => Response.json({}), d);
      expect(response.status).toBe(403);
    }
    expect(d.log).toHaveBeenCalledTimes(10);

    // Соседний адрес пишется своим счётом.
    await handleV1(
      request({ headers: { 'x-forwarded-for': '198.51.100.10' } }),
      async () => Response.json({}),
      d,
    );
    expect(d.log).toHaveBeenCalledTimes(11);
  });
});
