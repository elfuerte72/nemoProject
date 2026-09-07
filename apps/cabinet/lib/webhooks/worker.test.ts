import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookJob } from '@nemo/core';
import {
  deliverWebhook,
  isPrivateAddress,
  runWebhookTick,
  startWebhookWorker,
  webhookWorkerRunning,
  type WebhookWorkerDeps,
} from './worker';

/** Публичный адрес за именем: DNS в тесте не ходит. */
const PUBLIC = async () => ['203.0.113.7'];

/**
 * Воркер вебхуков без базы и без сети: приёмник — функция, очередь —
 * массив. Проверяется то, что глазом не видно: подпись в заголовке,
 * слова о неудаче, единственность таймера при повторном запуске.
 */

const job: WebhookJob = {
  deliveryId: 'd1',
  url: 'https://shop.example/hooks',
  secret: 'whsec_abc',
  body: '{"id":"d1","type":"ping"}',
  event: 'ping',
  attempt: 1,
};

describe('отправка', () => {
  it('шлёт тело как есть с подписью HMAC в заголовке', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));

    const result = await deliverWebhook(job, fetchImpl as unknown as typeof fetch, PUBLIC);

    expect(result).toMatchObject({ ok: true, responseStatus: 200, responseBody: 'ok' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(job.url);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(job.body);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-webhook-signature']).toBe(
      `sha256=${createHmac('sha256', job.secret).update(job.body).digest('hex')}`,
    );
    expect(headers['x-webhook-event']).toBe('ping');
  });

  it('не 2xx — неудача с кодом и первыми знаками ответа', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'.repeat(900), { status: 503 }));
    const result = await deliverWebhook(job, fetchImpl as unknown as typeof fetch, PUBLIC);
    expect(result).toMatchObject({ ok: false, responseStatus: 503, error: expect.stringContaining('503') });
    if (!result.ok) expect(result.responseBody?.length).toBe(500);
  });

  it('обрыв соединения — неудача словами, а не исключение', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    const result = await deliverWebhook(job, fetchImpl as unknown as typeof fetch, PUBLIC);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('ECONNREFUSED') });
  });

  it('молчание дольше срока — неудача со сроком в словах', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    );
    vi.useFakeTimers();
    const pending = deliverWebhook(job, fetchImpl as unknown as typeof fetch, PUBLIC);
    await vi.advanceTimersByTimeAsync(11_000);
    vi.useRealTimers();
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('10 с') });
  });
});

function deps(overrides: Partial<WebhookWorkerDeps> = {}): WebhookWorkerDeps {
  return {
    take: vi.fn(async () => [job]),
    record: vi.fn(async () => ({ notifications: [] })),
    deliver: vi.fn(async () => ({ ok: true as const, responseStatus: 200, responseBody: '', durationMs: 1 })),
    mail: vi.fn(async () => undefined),
    now: () => new Date('2026-09-07T10:00:00Z'),
    ...overrides,
  };
}

describe('куда указывает имя', () => {
  /**
   * Имя точки проверило ядро, но имя направляют куда угодно: публичное
   * `hooks.shop.example` может смотреть на `10.0.0.5`, и по нему сервис
   * пошёл бы своими руками во внутреннюю сеть.
   */
  it('имя на внутренний адрес — неудача без запроса', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    const result = await deliverWebhook(job, fetchImpl as unknown as typeof fetch, async () => [
      '10.0.0.5',
    ]);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('внутренн') });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('имя, которое не разрешилось, — неудача словами', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    const result = await deliverWebhook(job, fetchImpl as unknown as typeof fetch, async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('ENOTFOUND') });
  });

  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1',
  ])('%s — внутренний', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['203.0.113.7', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])(
    '%s — публичный',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('тик', () => {
  it('забирает, отправляет, записывает исход и шлёт письмо, если оно положено', async () => {
    const letter = { kind: 'merchant-webhook-failing' } as never;
    const d = deps({ record: vi.fn(async () => ({ notifications: [letter] })) });

    expect(await runWebhookTick(d)).toBe(1);

    expect(d.record).toHaveBeenCalledWith('d1', expect.objectContaining({ ok: true }), expect.any(Date));
    expect(d.mail).toHaveBeenCalledWith([letter]);
  });

  it('без писем почту не зовёт', async () => {
    const d = deps();
    await runWebhookTick(d);
    expect(d.mail).not.toHaveBeenCalled();
  });

  /** Отметка у точки уже стоит; легшая почта не должна ронять тик и соседние доставки. */
  it('отказ почты не роняет тик', async () => {
    const letter = { kind: 'merchant-webhook-failing' } as never;
    const d = deps({
      record: vi.fn(async () => ({ notifications: [letter] })),
      mail: vi.fn(async () => {
        throw new Error('провайдер лёг');
      }),
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(runWebhookTick(d)).resolves.toBe(1);
    spy.mockRestore();
  });
});

describe('запуск', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Next пересобирает модули в разработке; с переменной модуля таймеров
   * выходило бы столько, сколько было пересборок.
   */
  it('второй запуск не заводит второго таймера', async () => {
    const d = deps();
    const first = startWebhookWorker(d, 1000);
    const second = startWebhookWorker(d, 1000);
    expect(second).toBe(first);
    expect(webhookWorkerRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(d.take).toHaveBeenCalledTimes(1);

    first.stop();
    expect(webhookWorkerRunning()).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(d.take).toHaveBeenCalledTimes(1);
  });

  it('тик, который ещё идёт, следующим не догоняется', async () => {
    let release: (() => void) | undefined;
    const d = deps({
      take: vi.fn(
        () =>
          new Promise<readonly WebhookJob[]>((resolve) => {
            release = () => resolve([]);
          }),
      ),
    });
    const worker = startWebhookWorker(d, 1000);
    await vi.advanceTimersByTimeAsync(3500);
    expect(d.take).toHaveBeenCalledTimes(1);
    release?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.take).toHaveBeenCalledTimes(2);
    worker.stop();
  });
});
