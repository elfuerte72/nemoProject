import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { API_LOG_RETENTION_DAYS, createCore, type Actor } from './index.js';
import { givenMerchant } from './test-support.js';

/**
 * Журнал вызовов API: что мерчант спрашивал и что ему ответили.
 *
 * Пишет его адаптер после каждого вызова, читает мерчант в кабинете.
 * Проверяется то, что глазом не видно: свои строки от чужих, курсор
 * без потерь и дублей, счёт по исходам и чистка по сроку.
 */

const db = testDatabase();
const core = createCore({ db, apiKeyPrefix: 'sk_test_' });

let merchant: Actor & { type: 'merchant' };
let keyId: string;

beforeEach(async () => {
  await resetDatabase(db);
  merchant = await givenMerchant({ email: 'shop@example.com' });
  keyId = (await core.issueApiKey(merchant, { label: 'сайт' })).key.id;
});

afterAll(() => closeTestDatabase());

function entry(overrides: Partial<Parameters<typeof core.logApiRequest>[0]> = {}) {
  return {
    merchantId: merchant.merchantId,
    apiKeyId: keyId,
    method: 'GET',
    path: '/api/v1/rates',
    status: 200,
    durationMs: 12,
    address: '203.0.113.7',
    error: null,
    ...overrides,
  };
}

describe('журнал вызовов', () => {
  it('показывает мерчанту его вызовы, свежие первыми, с подписью ключа', async () => {
    await core.logApiRequest(entry({ at: new Date('2026-09-07T10:00:00Z') }));
    await core.logApiRequest(
      entry({
        at: new Date('2026-09-07T10:01:00Z'),
        method: 'POST',
        path: '/api/v1/exchange-requests',
        status: 422,
        error: 'Минимальная сумма обмена — 35 USDT',
      }),
    );

    const rows = await core.listApiRequestLog(merchant);
    expect(rows.map((one) => [one.method, one.status])).toEqual([
      ['POST', 422],
      ['GET', 200],
    ]);
    expect(rows[0]!.error).toBe('Минимальная сумма обмена — 35 USDT');
    expect(rows[0]!.keyLabel).toBe('сайт');
    expect(rows[1]!.error).toBeNull();
  });

  it('чужих вызовов не показывает', async () => {
    const other = await givenMerchant({ email: 'other@example.com' });
    await core.logApiRequest(entry());

    expect(await core.listApiRequestLog(other)).toEqual([]);
    expect(await core.countApiRequestLog(other)).toBe(0);
  });

  it('сужается по исходу: успешные отдельно от отказов', async () => {
    await core.logApiRequest(entry({ status: 200 }));
    await core.logApiRequest(entry({ status: 201 }));
    await core.logApiRequest(entry({ status: 401, error: 'Ключ отозван' }));

    expect(await core.listApiRequestLog(merchant, { outcome: 'ok' })).toHaveLength(2);
    expect(await core.listApiRequestLog(merchant, { outcome: 'error' })).toHaveLength(1);
    expect(await core.countApiRequestLog(merchant, { outcome: 'error' })).toBe(1);
  });

  /*
   * Вызовы по API идут пачкой, и десяток в одну секунду — норма. Курсор
   * по одному времени терял бы или дублировал их; пара «время и номер»
   * — нет.
   */
  it('дочитывается курсором без потерь и дублей при одном времени', async () => {
    const at = new Date('2026-09-07T10:00:00Z');
    for (let i = 0; i < 5; i += 1) {
      await core.logApiRequest(entry({ at, path: `/api/v1/exchange-requests/${i}` }));
    }

    const first = await core.listApiRequestLog(merchant, { limit: 2 });
    const last = first[first.length - 1]!;
    const second = await core.listApiRequestLog(merchant, {
      limit: 2,
      after: { at: last.at, id: last.id },
    });
    const third = await core.listApiRequestLog(merchant, {
      limit: 2,
      after: { at: second[second.length - 1]!.at, id: second[second.length - 1]!.id },
    });

    const seen = [...first, ...second, ...third].map((one) => one.path);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('испорченный номер в курсоре — отказ словами, а не падение', async () => {
    await expect(
      core.listApiRequestLog(merchant, { after: { at: new Date(), id: 'abc' } }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('считает плитки: успешных, с ошибкой, среднее время', async () => {
    await core.logApiRequest(entry({ status: 200, durationMs: 10 }));
    await core.logApiRequest(entry({ status: 200, durationMs: 30 }));
    await core.logApiRequest(entry({ status: 500, durationMs: 200, error: 'Внутренняя ошибка' }));

    const summary = await core.summarizeApiRequestLog(merchant, {
      since: new Date(Date.now() - 60_000),
    });
    expect(summary).toEqual({ total: 3, ok: 2, failed: 1, averageDurationMs: 80 });
  });

  it('без вызовов среднего времени нет — не ноль', async () => {
    const summary = await core.summarizeApiRequestLog(merchant, {
      since: new Date(Date.now() - 60_000),
    });
    expect(summary).toEqual({ total: 0, ok: 0, failed: 0, averageDurationMs: null });
  });

  it('чистка убирает строки старше срока и говорит, сколько убрала', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = new Date('2026-09-07T12:00:00Z');
    await core.logApiRequest(entry({ at: new Date(now.getTime() - 40 * dayMs) }));
    await core.logApiRequest(entry({ at: new Date(now.getTime() - 31 * dayMs) }));
    await core.logApiRequest(entry({ at: new Date(now.getTime() - 29 * dayMs) }));

    const olderThan = new Date(now.getTime() - API_LOG_RETENTION_DAYS * dayMs);
    expect(await core.purgeApiRequestLog(olderThan)).toBe(2);
    expect(await core.listApiRequestLog(merchant)).toHaveLength(1);
  });
});
