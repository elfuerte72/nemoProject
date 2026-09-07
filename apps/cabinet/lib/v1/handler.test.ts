import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidInputError, type ApiKeyAuth } from '@nemo/core';
import { ATTEMPT_LIMIT, forgetAttempts } from '@/lib/attempts';
import { forgetRateLimits, RATE_LIMITS } from './rate-limit';
import { forgetSeenSignatures, handleV1, type V1Deps } from './handler';
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

const OK: ApiKeyAuth = { ok: true, merchantId: MERCHANT_ID, keyId: KEY_ID, signatureRequired: false };

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
