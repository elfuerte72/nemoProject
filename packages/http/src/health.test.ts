import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthResponse } from './health.js';

/**
 * Ответ `/api/health`: три состояния базы и то, чего в ответе быть не
 * должно.
 */

afterEach(() => {
  vi.useRealTimers();
});

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('healthResponse', () => {
  it('отвечает 200 и называет приложение, коммит и базу, когда база жива', async () => {
    const response = await healthResponse({
      app: 'miniapp',
      version: 'abc123',
      ping: async () => undefined,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await bodyOf(response)).toEqual({
      ok: true,
      app: 'miniapp',
      version: 'abc123',
      database: 'ok',
    });
  });

  it('отвечает 503 и не пересказывает ошибку, когда база отвергает', async () => {
    const response = await healthResponse({
      app: 'admin',
      version: null,
      ping: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.7:5432');
      },
    });

    expect(response.status).toBe(503);
    const body = await bodyOf(response);
    expect(body).toEqual({ ok: false, app: 'admin', version: null, database: 'unreachable' });
    expect(JSON.stringify(body)).not.toContain('10.0.0.7');
  });

  it('считает синхронный бросок тем же отказом, а не поломкой маршрута', async () => {
    const response = await healthResponse({
      app: 'miniapp',
      version: null,
      ping: () => {
        throw new Error('Не задан DATABASE_URL');
      },
    });

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).database).toBe('unreachable');
  });

  it('не ждёт молчащую базу дольше срока', async () => {
    vi.useFakeTimers();
    const pending = healthResponse({
      app: 'miniapp',
      version: 'abc123',
      ping: () => new Promise(() => {}),
      timeoutMs: 3_000,
    });

    await vi.advanceTimersByTimeAsync(3_000);
    const response = await pending;

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).database).toBe('timeout');
  });
});
