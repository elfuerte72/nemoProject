import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { generateRequisiteKeyPair } from '@nemo/crypto';
import { webhookDeliveries, webhookEndpoints } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  createCore,
  looksLikeWebhookUrl,
  signWebhookBody,
  WEBHOOK_LEASE_MS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_MINUTES,
  type Actor,
} from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenMerchant,
  givenNetwork,
  givenServiceSettings,
  givenStaff,
} from './test-support.js';

/**
 * Вебхуки — исходящая очередь в базе (docs/adr/0018).
 *
 * Строка доставки появляется в той же транзакции, что и переход заявки,
 * и не появляется без точки; воркер забирает её однажды; повторы идут
 * по расписанию; пятая неудача — письмо и отметка у точки. Время
 * везде передаётся параметром: «через час» — это другое значение
 * аргумента, а не подменённые часы.
 */

const db = testDatabase();
// Получатель в теле подачи шифруется, и ключ для этого нужен.
const core = createCore({ db, requisites: { publicKey: generateRequisiteKeyPair().publicKey } });

let merchant: Actor & { type: 'merchant' };

const URL_OK = 'https://shop.example/hooks/tobee';
const PAYOUT = { kind: 'card', bankName: 'Сбербанк', cardNumber: '4111111111111111' } as const;

/*
 * Точка отсчёта — чуть впереди часов машины, а не дата в кавычках:
 * пробная доставка встаёт в очередь на «сейчас», и день, записанный
 * числом, назавтра оказывался в прошлом — забор по нему ничего не
 * находил. Так и случилось 7 сентября 2026 в 10:02 UTC: прогон по dev
 * начался через две минуты после записанного T0 и упал.
 */
const T0 = new Date(Date.now() + 60_000);
const minutesLater = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

beforeEach(async () => {
  await resetDatabase(db);
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenNetwork('TRC20');
  await givenServiceSettings({ minExchangeAmount: '10' });
  merchant = await givenMerchant({ email: 'shop@example.com' });
});

afterAll(() => closeTestDatabase());

async function submit(actor: Actor = merchant, fromAmount = '100') {
  return core.submitExchangeRequest(actor, {
    kind: 'electronic',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount,
    payout: PAYOUT,
  });
}

describe('адрес точки', () => {
  it.each([
    ['http://shop.example/hooks', /https/],
    ['https://localhost/hooks', /публичн/i],
    ['https://127.0.0.1/hooks', /IP/],
    ['https://10.0.0.5/hooks', /IP/],
    ['https://[::1]/hooks', /IP/],
    ['https://intranet/hooks', /публичн/i],
    ['https://shop.local/hooks', /публичн/i],
    ['https://user:pass@shop.example/hooks', /логин/i],
    ['https://webhook.site/abc', /одноразов/i],
    ['не адрес', /адрес/i],
  ])('%s отвергается словами', (url, words) => {
    const check = looksLikeWebhookUrl(url);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.complaint).toMatch(words);
  });

  it('https на публичный хост принимается', () => {
    expect(looksLikeWebhookUrl(URL_OK)).toEqual({ ok: true });
    expect(looksLikeWebhookUrl('https://api.shop.example:8443/x?y=1')).toEqual({ ok: true });
  });
});

describe('точка вебхука', () => {
  it('заводится с секретом, который показывается один раз и в списке не виден', async () => {
    const added = await core.addWebhookEndpoint(merchant, {
      url: URL_OK,
      events: ['exchange_request.created', 'exchange_request.completed'],
    });

    expect(added.secret.startsWith('whsec_')).toBe(true);
    expect(added.endpoint.url).toBe(URL_OK);
    expect(added.endpoint.events).toEqual([
      'exchange_request.created',
      'exchange_request.completed',
    ]);

    const listed = await core.listWebhookEndpoints(merchant);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(added.secret);
  });

  it('без событий или с чужим событием не заводится', async () => {
    await expect(core.addWebhookEndpoint(merchant, { url: URL_OK, events: [] })).rejects.toMatchObject(
      { code: 'invalid-input' },
    );
    await expect(
      core.addWebhookEndpoint(merchant, { url: URL_OK, events: ['order.paid' as never] }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      core.addWebhookEndpoint(merchant, { url: 'http://shop.example', events: ['ping'] }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('отключённый мерчант точку не заводит, но паузу и удаление делает', async () => {
    const { endpoint } = await core.addWebhookEndpoint(merchant, {
      url: URL_OK,
      events: ['ping'],
    });
    const admin = await givenStaff({ role: 'admin' });
    await core.setMerchantActive(admin, merchant.merchantId, false);

    await expect(
      core.addWebhookEndpoint(merchant, { url: URL_OK, events: ['ping'] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await core.setWebhookEndpointPaused(merchant, endpoint.id, true)).pausedAt).toBeInstanceOf(
      Date,
    );
    await core.removeWebhookEndpoint(merchant, endpoint.id);
    expect(await core.listWebhookEndpoints(merchant)).toEqual([]);
  });

  it('чужая точка — «не найдена»', async () => {
    const { endpoint } = await core.addWebhookEndpoint(merchant, { url: URL_OK, events: ['ping'] });
    const other = await givenMerchant({ email: 'other@example.com' });

    await expect(core.setWebhookEndpointPaused(other, endpoint.id, true)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(core.enqueueWebhookPing(other, endpoint.id)).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});

describe('очередь доставок', () => {
  it('переход заявки кладёт доставку в ту же транзакцию — тонким телом', async () => {
    const { endpoint } = await core.addWebhookEndpoint(merchant, {
      url: URL_OK,
      events: ['exchange_request.created', 'exchange_request.rate_confirmed'],
    });

    const { request } = await submit();
    const [created] = await core.listWebhookDeliveries(merchant);
    expect(created).toMatchObject({
      endpointId: endpoint.id,
      event: 'exchange_request.created',
      requestId: request.id,
      status: 'pending',
      attempt: 0,
    });
    const body = JSON.parse(created!.body) as Record<string, unknown>;
    expect(body).toEqual({
      id: created!.id,
      type: 'exchange_request.created',
      requestId: request.id,
      status: 'new',
      at: expect.any(String),
    });
    // Ничего сверх тонкого тела: ни сумм, ни реквизитов.
    expect(Object.keys(body).sort()).toEqual(['at', 'id', 'requestId', 'status', 'type']);

    const manager = await givenStaff();
    await core.claimExchangeRequest(manager, request.id);
    // «Взята в работу» — не событие: подписки на неё нет.
    expect(await core.listWebhookDeliveries(merchant)).toHaveLength(1);

    await core.confirmExchangeRate(manager, request.id, {
      finalRate: '81',
      paymentInstructions: 'Кошелёк TRC20: TQmX…',
    });
    const [confirmed] = await core.listWebhookDeliveries(merchant);
    expect(confirmed).toMatchObject({ event: 'exchange_request.rate_confirmed', requestId: request.id });
  });

  it('без подписки на событие, у клиента и у точки на паузе доставки нет', async () => {
    const { endpoint } = await core.addWebhookEndpoint(merchant, {
      url: URL_OK,
      events: ['exchange_request.completed'],
    });
    await submit();
    expect(await core.listWebhookDeliveries(merchant)).toEqual([]);

    await core.setWebhookEndpointPaused(merchant, endpoint.id, false);
    const { endpoint: subscribed } = await core.addWebhookEndpoint(merchant, {
      url: 'https://second.example/hooks',
      events: ['exchange_request.created'],
    });
    await core.setWebhookEndpointPaused(merchant, subscribed.id, true);
    await submit();
    expect(await core.listWebhookDeliveries(merchant)).toEqual([]);

    // Заявка клиента вебхуков не порождает: точек у него не бывает.
    await core.registerClient({ telegramUserId: 1n });
    await core.submitExchangeRequest(asClient(1n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
    });
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
  });

  it('отвергнутая подача доставки не оставляет: строка живёт в транзакции заявки', async () => {
    await core.addWebhookEndpoint(merchant, { url: URL_OK, events: ['exchange_request.created'] });
    await expect(submit(merchant, '1')).rejects.toMatchObject({ code: 'invalid-input' });
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
  });

  it('истечение срока оплаты тоже сообщается', async () => {
    await givenServiceSettings({ unpaidExchangeRequestTtlMinutes: 60 });
    await core.addWebhookEndpoint(merchant, { url: URL_OK, events: ['exchange_request.cancelled'] });
    const { request } = await submit();
    const manager = await givenStaff();
    await core.claimExchangeRequest(manager, request.id);
    await core.confirmExchangeRate(manager, request.id, {
      finalRate: '81',
      paymentInstructions: 'Кошелёк',
    });

    await core.expireUnpaidExchangeRequests(new Date(Date.now() + 61 * 60_000));

    const [cancelled] = await core.listWebhookDeliveries(merchant);
    expect(cancelled).toMatchObject({ event: 'exchange_request.cancelled', requestId: request.id });
    expect(JSON.parse(cancelled!.body)).toMatchObject({ status: 'cancelled' });
  });

  it('пробное — доставка без заявки', async () => {
    const { endpoint } = await core.addWebhookEndpoint(merchant, { url: URL_OK, events: ['ping'] });
    const ping = await core.enqueueWebhookPing(merchant, endpoint.id);
    expect(ping).toMatchObject({ event: 'ping', requestId: null, status: 'pending' });
    expect(JSON.parse(ping.body)).toMatchObject({ id: ping.id, type: 'ping' });
  });

  it('удаление точки гасит её ожидающие доставки', async () => {
    const { endpoint } = await core.addWebhookEndpoint(merchant, { url: URL_OK, events: ['ping'] });
    await core.enqueueWebhookPing(merchant, endpoint.id);

    await core.removeWebhookEndpoint(merchant, endpoint.id);

    expect(await core.takeDueWebhookDeliveries({ now: minutesLater(5), limit: 10 })).toEqual([]);
    const [row] = await db.select().from(webhookDeliveries);
    expect(row).toMatchObject({ status: 'failed' });
  });
});

describe('подпись', () => {
  it('sha256=HMAC секрета от тела', () => {
    const body = '{"id":"x"}';
    const expected = createHmac('sha256', 'whsec_abc').update(body).digest('hex');
    expect(signWebhookBody('whsec_abc', body)).toBe(`sha256=${expected}`);
  });
});

describe('воркер', () => {
  async function givenPing() {
    const added = await core.addWebhookEndpoint(merchant, { url: URL_OK, events: ['ping'] });
    const ping = await core.enqueueWebhookPing(merchant, added.endpoint.id);
    return { ...added, ping };
  }

  it('забирает подошедшие доставки с адресом и секретом — и второй раз ту же не отдаёт', async () => {
    const { ping, secret } = await givenPing();

    const jobs = await core.takeDueWebhookDeliveries({ now: T0, limit: 10 });
    expect(jobs).toEqual([
      expect.objectContaining({ deliveryId: ping.id, url: URL_OK, secret, event: 'ping', attempt: 1 }),
    ]);
    expect(JSON.parse(jobs[0]!.body)).toMatchObject({ type: 'ping' });

    // Пока строка в полёте, её не отдают: лизинг на пару минут.
    expect(await core.takeDueWebhookDeliveries({ now: minutesLater(1), limit: 10 })).toEqual([]);
    // Процесс упал посреди отправки — после лизинга строку заберут снова.
    const again = await core.takeDueWebhookDeliveries({
      now: new Date(T0.getTime() + WEBHOOK_LEASE_MS + 1000),
      limit: 10,
    });
    expect(again.map((one) => one.attempt)).toEqual([2]);
  });

  /** Два процесса кабинета берут очередь разом: `skip locked` делит её, а не дублирует. */
  it('два забора разом делят строки, а не берут одну дважды', async () => {
    const { endpoint } = await givenPing();
    await core.enqueueWebhookPing(merchant, endpoint.id);
    await core.enqueueWebhookPing(merchant, endpoint.id);

    const [left, right] = await Promise.all([
      core.takeDueWebhookDeliveries({ now: T0, limit: 2 }),
      core.takeDueWebhookDeliveries({ now: T0, limit: 2 }),
    ]);
    const ids = [...left, ...right].map((one) => one.deliveryId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('только названная строка — пробная доставка не разбирает чужую очередь', async () => {
    const { ping, endpoint } = await givenPing();
    const other = await core.enqueueWebhookPing(merchant, endpoint.id);

    const jobs = await core.takeDueWebhookDeliveries({ now: T0, limit: 10, deliveryId: other.id });
    expect(jobs.map((one) => one.deliveryId)).toEqual([other.id]);
    // Первая осталась в очереди.
    expect(
      (await core.takeDueWebhookDeliveries({ now: T0, limit: 10 })).map((one) => one.deliveryId),
    ).toEqual([ping.id]);
  });

  it('удачный ответ закрывает доставку и снимает отметку с точки', async () => {
    const { ping, endpoint } = await givenPing();
    await db
      .update(webhookEndpoints)
      .set({ failingSince: T0 })
      .where(eq(webhookEndpoints.id, endpoint.id));
    await core.takeDueWebhookDeliveries({ now: T0, limit: 10 });

    const { notifications } = await core.recordWebhookDeliveryResult(
      ping.id,
      { ok: true, responseStatus: 200, responseBody: 'ok', durationMs: 120 },
      minutesLater(0.1),
    );
    expect(notifications).toEqual([]);

    const [delivery] = await core.listWebhookDeliveries(merchant);
    expect(delivery).toMatchObject({
      status: 'delivered',
      attempt: 1,
      responseStatus: 200,
      responseBody: 'ok',
      durationMs: 120,
    });
    expect(delivery!.deliveredAt).toBeInstanceOf(Date);
    const [listed] = await core.listWebhookEndpoints(merchant);
    expect(listed!.failingSince).toBeNull();
  });

  it('повторы идут через 1, 5, 15 и 60 минут, пятая неудача — провал, письмо и отметка', async () => {
    const { ping, endpoint } = await givenPing();
    let now = T0;

    for (let attempt = 1; attempt < WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
      const jobs = await core.takeDueWebhookDeliveries({ now, limit: 10 });
      expect(jobs.map((one) => one.attempt)).toEqual([attempt]);

      const { notifications } = await core.recordWebhookDeliveryResult(
        ping.id,
        { ok: false, responseStatus: 502, responseBody: 'bad gateway', error: 'Ответ 502', durationMs: 30 },
        now,
      );
      expect(notifications).toEqual([]);

      const [delivery] = await core.listWebhookDeliveries(merchant);
      const wait = WEBHOOK_RETRY_MINUTES[attempt - 1]!;
      expect(delivery).toMatchObject({ status: 'pending', attempt, error: 'Ответ 502' });
      expect(delivery!.nextAttemptAt.getTime()).toBe(now.getTime() + wait * 60_000);
      // Раньше срока строку не отдают.
      expect(await core.takeDueWebhookDeliveries({ now: new Date(now.getTime() + wait * 60_000 - 1000), limit: 10 })).toEqual([]);
      now = new Date(now.getTime() + wait * 60_000);
    }

    const last = await core.takeDueWebhookDeliveries({ now, limit: 10 });
    expect(last.map((one) => one.attempt)).toEqual([WEBHOOK_MAX_ATTEMPTS]);
    const { notifications } = await core.recordWebhookDeliveryResult(
      ping.id,
      { ok: false, error: 'Соединение отклонено', durationMs: 5 },
      now,
    );
    expect(notifications).toEqual([
      expect.objectContaining({
        kind: 'merchant-webhook-failing',
        to: expect.objectContaining({ kind: 'merchant', email: 'shop@example.com' }),
        url: URL_OK,
        event: 'ping',
      }),
    ]);

    const [delivery] = await core.listWebhookDeliveries(merchant);
    expect(delivery).toMatchObject({ status: 'failed', attempt: WEBHOOK_MAX_ATTEMPTS });
    const [listed] = await core.listWebhookEndpoints(merchant);
    expect(listed!.id).toBe(endpoint.id);
    expect(listed!.failingSince).toEqual(now);
    // Провалившаяся строка больше не берётся.
    expect(await core.takeDueWebhookDeliveries({ now: minutesLater(600), limit: 10 })).toEqual([]);
  });

  /**
   * Две доставки одной точки проваливаются разом — истечение срока
   * пачкой даёт им одно расписание. Письмо всё равно одно: отметку
   * ставит условное изменение, а не «прочитал — записал».
   */
  it('две пятые неудачи разом — одно письмо, а не два', async () => {
    const { endpoint } = await givenPing();
    const first = await core.enqueueWebhookPing(merchant, endpoint.id);
    const second = await core.enqueueWebhookPing(merchant, endpoint.id);
    await db
      .update(webhookDeliveries)
      .set({ attempt: WEBHOOK_MAX_ATTEMPTS - 1 })
      .where(eq(webhookDeliveries.endpointId, endpoint.id));
    await core.takeDueWebhookDeliveries({ now: T0, limit: 10 });

    const failure = { ok: false as const, error: 'Ответ 502', durationMs: 5 };
    const results = await Promise.all([
      core.recordWebhookDeliveryResult(first.id, failure, T0),
      core.recordWebhookDeliveryResult(second.id, failure, T0),
    ]);
    expect(results.flatMap((one) => one.notifications)).toHaveLength(1);
  });

  /** Одно письмо на приступ, а не на каждое событие: точка лежит — сотня писем не поможет. */
  it('пока точка отмечена неотвечающей, второго письма нет', async () => {
    const { endpoint } = await givenPing();
    await db.update(webhookEndpoints).set({ failingSince: T0 }).where(eq(webhookEndpoints.id, endpoint.id));
    const ping = await core.enqueueWebhookPing(merchant, endpoint.id);
    await db
      .update(webhookDeliveries)
      .set({ attempt: WEBHOOK_MAX_ATTEMPTS - 1 })
      .where(eq(webhookDeliveries.id, ping.id));

    await core.takeDueWebhookDeliveries({ now: T0, limit: 10 });
    const { notifications } = await core.recordWebhookDeliveryResult(
      ping.id,
      { ok: false, error: 'Срок вышел', durationMs: 10_000 },
      T0,
    );
    expect(notifications).toEqual([]);
  });

  it('ответ приёмника хранится первыми пятьюстами знаками', async () => {
    const { ping } = await givenPing();
    await core.takeDueWebhookDeliveries({ now: T0, limit: 10 });
    await core.recordWebhookDeliveryResult(
      ping.id,
      { ok: true, responseStatus: 200, responseBody: 'x'.repeat(2000), durationMs: 1 },
      T0,
    );
    const [delivery] = await core.listWebhookDeliveries(merchant);
    expect(delivery!.responseBody!.length).toBe(500);
  });
});

describe('здоровье доставок глазами сотрудника', () => {
  it('сотрудник видит точки мерчанта и отметку неотвечающей, без секрета', async () => {
    const { endpoint, secret } = await core.addWebhookEndpoint(merchant, {
      url: URL_OK,
      events: ['ping'],
    });
    await db.update(webhookEndpoints).set({ failingSince: T0 }).where(eq(webhookEndpoints.id, endpoint.id));
    const manager = await givenStaff();

    const health = await core.listMerchantWebhookEndpoints(manager, merchant.merchantId);
    expect(health).toEqual([expect.objectContaining({ id: endpoint.id, url: URL_OK, failingSince: T0 })]);
    expect(JSON.stringify(health)).not.toContain(secret);

    await expect(core.listMerchantWebhookEndpoints(merchant, merchant.merchantId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
