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

  /*
   * Журнал — раздел владельца, как ключи и вебхуки: в нём адреса машин
   * и слова отказов интеграции. До 24 сентября 2026 страница была
   * закрыта по таблице прав, а маршрут дочитывания отдавал хвост любой
   * роли — спрятанная кнопка ничего не запрещала.
   */
  it('оператору и наблюдателю журнал не открыт — по той же таблице прав, что меню', async () => {
    await core.logApiRequest(entry());
    for (const role of ['operator', 'viewer'] as const) {
      const someone: Actor = { ...merchant, role };
      await expect(core.listApiRequestLog(someone)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(core.countApiRequestLog(someone)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        core.summarizeApiRequestLog(someone, { since: new Date(0) }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        core.listApiCallerAddresses(someone, { since: new Date(0) }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('сужается по исходу: успешные отдельно от отказов', async () => {
    await core.logApiRequest(entry({ status: 200 }));
    await core.logApiRequest(entry({ status: 201 }));
    await core.logApiRequest(entry({ status: 401, error: 'Ключ отозван' }));

    expect(await core.listApiRequestLog(merchant, { outcome: 'ok' })).toHaveLength(2);
    expect(await core.listApiRequestLog(merchant, { outcome: 'error' })).toHaveLength(1);
    expect(await core.countApiRequestLog(merchant, { outcome: 'error' })).toBe(1);
  });

  it('хранит идентификатор запроса и машинный код отказа', async () => {
    const requestId = '0b6f3c1e-5d0a-4a8e-9f3e-2c1b7d4a9e10';
    await core.logApiRequest(
      entry({ status: 401, error: 'Подпись не сходится', errorCode: 'invalid_signature', requestId }),
    );
    await core.logApiRequest(entry());

    const [failed, ok] = [
      ...(await core.listApiRequestLog(merchant, { outcome: 'error' })),
      ...(await core.listApiRequestLog(merchant, { outcome: 'ok' })),
    ];
    expect(failed).toMatchObject({ requestId, errorCode: 'invalid_signature' });
    expect(ok).toMatchObject({ requestId: null, errorCode: null });
  });

  it('сужается по методу', async () => {
    await core.logApiRequest(entry({ method: 'GET' }));
    await core.logApiRequest(entry({ method: 'POST', path: '/api/v1/quote' }));

    const rows = await core.listApiRequestLog(merchant, { method: 'POST' });
    expect(rows.map((one) => one.path)).toEqual(['/api/v1/quote']);
    expect(await core.countApiRequestLog(merchant, { method: 'POST' })).toBe(1);
  });

  it('незнакомый метод в фильтре — отказ словами: сужать чем попало нечего', async () => {
    await expect(core.listApiRequestLog(merchant, { method: 'TRACE' })).rejects.toMatchObject({
      code: 'invalid-input',
    });
  });

  it('ищет по части пути без учёта регистра', async () => {
    await core.logApiRequest(entry({ path: '/api/v1/exchange-requests/abc' }));
    await core.logApiRequest(entry({ path: '/api/v1/rates' }));

    const rows = await core.listApiRequestLog(merchant, { search: 'EXCHANGE' });
    expect(rows.map((one) => one.path)).toEqual(['/api/v1/exchange-requests/abc']);
    expect(await core.countApiRequestLog(merchant, { search: 'exchange' })).toBe(1);
  });

  /*
   * Процент и подчёркивание — знаки шаблона LIKE. Не экранированные,
   * «%» нашёл бы всё, а «_» — любой знак: поиск по «rate_limited»
   * находил бы «ratexlimited».
   */
  it('знаки шаблона в поиске — буквальные, а не шаблон', async () => {
    await core.logApiRequest(entry({ path: '/api/v1/rates' }));

    expect(await core.listApiRequestLog(merchant, { search: '%' })).toEqual([]);
    expect(await core.listApiRequestLog(merchant, { search: 'r_tes' })).toEqual([]);
  });

  it('находит вызов по идентификатору запроса из заголовка ответа', async () => {
    const requestId = '7d3c1e0b-5d0a-4a8e-9f3e-2c1b7d4a9e10';
    await core.logApiRequest(entry({ requestId, path: '/api/v1/quote' }));
    await core.logApiRequest(entry());

    const rows = await core.listApiRequestLog(merchant, { search: requestId.toUpperCase() });
    expect(rows.map((one) => one.path)).toEqual(['/api/v1/quote']);
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
    expect(summary).toEqual({
      total: 3,
      ok: 2,
      failed: 1,
      rateLimited: 0,
      averageDurationMs: 80,
    });
  });

  it('без вызовов среднего времени нет — не ноль', async () => {
    const summary = await core.summarizeApiRequestLog(merchant, {
      since: new Date(Date.now() - 60_000),
    });
    expect(summary).toEqual({
      total: 0,
      ok: 0,
      failed: 0,
      rateLimited: 0,
      averageDurationMs: null,
    });
  });

  it('считает, сколько раз упёрлись в предел: это отдельный вопрос карточки «Ограничения»', async () => {
    await core.logApiRequest(entry({ status: 429, errorCode: 'rate_limited', error: 'Слишком много' }));
    await core.logApiRequest(entry({ status: 429, errorCode: 'rate_limited', error: 'Слишком много' }));
    await core.logApiRequest(entry({ status: 401, errorCode: 'invalid_signature', error: 'Подпись' }));

    const summary = await core.summarizeApiRequestLog(merchant, {
      since: new Date(Date.now() - 60_000),
    });
    expect(summary.rateLimited).toBe(2);
    expect(summary.failed).toBe(3);
  });

  /*
   * По этому списку владелец заводит разрешённые адреса: вписывать
   * адрес своего сервера по памяти — верный способ запереть интеграцию.
   */
  it('называет адреса, с которых звали за период, свежие первыми, с числом вызовов', async () => {
    const since = new Date(Date.now() - 60_000);
    await core.logApiRequest(entry({ address: '203.0.113.7', at: new Date(Date.now() - 30_000) }));
    await core.logApiRequest(entry({ address: '203.0.113.7', at: new Date(Date.now() - 20_000) }));
    await core.logApiRequest(entry({ address: '198.51.100.9', at: new Date(Date.now() - 10_000) }));
    await core.logApiRequest(entry({ address: '192.0.2.1', at: new Date(Date.now() - 120_000) }));
    await core.logApiRequest(entry({ address: null }));

    const other = await givenMerchant({ email: 'other@example.com' });
    const otherKey = (await core.issueApiKey(other, { label: 'чужой' })).key.id;
    await core.logApiRequest(
      entry({ merchantId: other.merchantId, apiKeyId: otherKey, address: '192.0.2.99' }),
    );

    const callers = await core.listApiCallerAddresses(merchant, { since });
    expect(callers.map((one) => [one.address, one.calls])).toEqual([
      ['198.51.100.9', 1],
      ['203.0.113.7', 2],
    ]);
  });

  /*
   * Ключ утёк, вор зовёт с чужой машины и получает 403 — а его адрес
   * стоит в том же списке, что и сервер мерчанта. Отличает их одно:
   * был ли у адреса хоть один удачный вызов. По этому экран решает,
   * предлагать ли «Разрешить».
   */
  /*
   * «Пропущен на входе» — прошёл ключ, подпись и адрес, чем бы ни
   * кончился дальше: 422 по правилу обмена — это наш сервер, дошедший до
   * правила, а не чужой. Отвергнутые на входе — 401 и 403.
   */
  it('считает вызовы адреса, пропущенные на входе, отдельно от отвергнутых', async () => {
    const since = new Date(Date.now() - 60_000);
    await core.logApiRequest(entry({ address: '203.0.113.7', status: 200 }));
    await core.logApiRequest(entry({ address: '203.0.113.7', status: 422, error: 'нет' }));
    await core.logApiRequest(entry({ address: '192.0.2.5', status: 422, error: 'нет' }));
    await core.logApiRequest(
      entry({ address: '198.51.100.9', status: 403, errorCode: 'address_not_allowed', error: 'нет' }),
    );
    await core.logApiRequest(
      entry({ address: '198.51.100.9', status: 401, errorCode: 'invalid_signature', error: 'нет' }),
    );

    const callers = await core.listApiCallerAddresses(merchant, { since });
    const byAddress = Object.fromEntries(callers.map((one) => [one.address, one]));
    expect(byAddress['203.0.113.7']).toMatchObject({ calls: 2, admitted: 2 });
    expect(byAddress['192.0.2.5']).toMatchObject({ calls: 1, admitted: 1 });
    expect(byAddress['198.51.100.9']).toMatchObject({ calls: 2, admitted: 0 });
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
