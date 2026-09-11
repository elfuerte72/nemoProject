import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  signWebhookBody,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_MINUTES,
  WEBHOOK_TIMEOUT_MS,
  slopComplaints,
  type WebhookJob,
} from '@nemo/core';
import { webhookEvents } from '@nemo/types';
import {
  SIGNATURE_EXAMPLES,
  WEBHOOK_BODY_FIELDS,
  WEBHOOK_EVENT_EXAMPLES,
  WEBHOOK_CHECKLIST,
  WEBHOOK_GUIDE_RULES,
  WEBHOOK_HEADERS,
} from './webhook-guide';
import { deliverWebhook } from './webhooks/worker';

/**
 * Страница «как встроить» сверяется не с памятью о формате, а с
 * воркером и с ядром: заголовки берутся из настоящей отправки, поля
 * тела — из настоящего тела, пример на Node.js исполняется и проверяет
 * настоящую подпись.
 *
 * Иначе страница врёт молча: код правят, а объяснение остаётся прежним,
 * и разработчик мерчанта отлаживает наш вчерашний формат.
 */

const PUBLIC = async () => ['203.0.113.7'];

const job: WebhookJob = {
  deliveryId: 'd1',
  url: 'https://shop.example/hooks',
  secret: 'whsec_abc',
  body: '{"id":"d1","type":"ping","requestId":null,"status":null,"at":"2026-09-10T09:00:00.000Z"}',
  event: 'ping',
  attempt: 1,
};

async function sentHeaders(): Promise<Record<string, string>> {
  const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
  await deliverWebhook(job, fetchImpl as unknown as typeof fetch, PUBLIC);
  const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  return init.headers as Record<string, string>;
}

describe('таблица заголовков', () => {
  it('называет ровно те заголовки, что воркер и шлёт', async () => {
    const headers = await sentHeaders();
    expect(WEBHOOK_HEADERS.map((one) => one.name).sort()).toEqual(Object.keys(headers).sort());
  });

  it('значения постоянных заголовков совпадают с отправленными', async () => {
    const headers = await sentHeaders();
    for (const row of WEBHOOK_HEADERS) {
      if (row.value === undefined) continue;
      expect(headers[row.name], row.name).toBe(row.value);
    }
  });
});

describe('тело события', () => {
  it('таблица полей называет ровно те поля, что лежат в теле', () => {
    for (const example of WEBHOOK_EVENT_EXAMPLES) {
      const body = JSON.parse(example.body) as Record<string, unknown>;
      expect(WEBHOOK_BODY_FIELDS.map((one) => one.name).sort(), example.event).toEqual(
        Object.keys(body).sort(),
      );
    }
  });

  it('пример есть у каждого события, включая пробное', () => {
    expect(WEBHOOK_EVENT_EXAMPLES.map((one) => one.event)).toEqual([...webhookEvents]);
  });

  it('у пробного нет ни заявки, ни состояния — заявки за ним не стоит', () => {
    const ping = WEBHOOK_EVENT_EXAMPLES.find((one) => one.event === 'ping');
    expect(JSON.parse(ping!.body)).toMatchObject({ requestId: null, status: null });
  });
});

describe('пример проверки подписи', () => {
  /**
   * Пример на Node.js исполняется прямо здесь: строка `import` для
   * этого снимается, остальное — тот же текст, что видит мерчант.
   * Примеры на Python и PHP запустить нечем, и от них проверяется
   * только то, что имя заголовка и вид подписи в них наши.
   */
  function runNodeExample() {
    const source = SIGNATURE_EXAMPLES.find((one) => one.language === 'node')!.code;
    const runnable = source
      .split('\n')
      .filter((line) => !line.startsWith('import '))
      .join('\n');

    // Обвязка Express — заглушками: пример показан целиком, вместе с
    // маршрутом, и исполняется он тоже целиком.
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = {
      post: (path: string, _middleware: unknown, handler: (req: unknown, res: unknown) => void) => {
        routes[path] = handler;
      },
    };
    const express = { raw: () => 'raw-body-middleware' };
    const queued: unknown[] = [];
    const queue = { add: (event: unknown) => queued.push(event) };
    const env = { TOBEE_WEBHOOK_SECRET: job.secret };

    const verify = new Function(
      'createHmac',
      'timingSafeEqual',
      'app',
      'express',
      'queue',
      'process',
      `${runnable}\nreturn verifyWebhook;`,
    )(createHmac, timingSafeEqual, app, express, queue, { env }) as (
      rawBody: string,
      signature: string,
      secret: string,
    ) => boolean;

    return { verify, routes, queued };
  }

  it('на Node.js принимает нашу подпись и отвергает подменённое тело', () => {
    const { verify } = runNodeExample();
    const signature = signWebhookBody(job.secret, job.body);

    expect(verify(job.body, signature, job.secret)).toBe(true);
    // Тело, пересобранное после разбора, подписи не даёт: на этом и
    // спотыкаются, а пример потому и считает по сырому.
    expect(verify(JSON.stringify(JSON.parse(job.body)) + ' ', signature, job.secret)).toBe(false);
    expect(verify(job.body, signature, 'whsec_other')).toBe(false);
  });

  it('маршрут из примера отвечает 200 на нашу доставку и 401 на чужую подпись', () => {
    const { routes, queued } = runNodeExample();
    const handler = routes['/hooks/tobee'];
    expect(handler).toBeDefined();

    const answer = (signature: string): number[] => {
      const codes: number[] = [];
      handler!(
        { body: Buffer.from(job.body), get: () => signature },
        { sendStatus: (code: number) => codes.push(code) },
      );
      return codes;
    };

    expect(answer(signWebhookBody(job.secret, job.body))).toEqual([200]);
    expect(queued).toEqual([JSON.parse(job.body)]);
    expect(answer('sha256=deadbeef')).toEqual([401]);
  });

  it.each(['python', 'php'] as const)('на %s назван наш заголовок и вид подписи', (language) => {
    const example = SIGNATURE_EXAMPLES.find((one) => one.language === language)!;
    expect(example.code).toContain('x-webhook-signature');
    expect(example.code).toContain('sha256=');
  });

  it('в примере на PHP отпускание соединения защищено проверкой', () => {
    // `fastcgi_finish_request` есть только под PHP-FPM. Без проверки
    // строка роняет обработчик уже после отправленного нам 200: мы
    // считаем доставку удачной, а событие у мерчанта не обработано.
    const php = SIGNATURE_EXAMPLES.find((one) => one.language === 'php')!.code;
    expect(php).toContain("function_exists('fastcgi_finish_request')");
  });
});

describe('правила', () => {
  it('сроки и повторы взяты из ядра, а не набраны рядом', () => {
    const text = WEBHOOK_GUIDE_RULES.map((one) => `${one.title} ${one.detail}`).join('\n');
    expect(text).toContain(String(WEBHOOK_TIMEOUT_MS / 1000));
    expect(text).toContain(String(WEBHOOK_MAX_ATTEMPTS));
    for (const minutes of WEBHOOK_RETRY_MINUTES) expect(text).toContain(String(minutes));
  });

  it('набраны человеком', () => {
    for (const rule of [...WEBHOOK_GUIDE_RULES, ...WEBHOOK_CHECKLIST]) {
      expect(slopComplaints(`${rule.title}\n${rule.detail}`), rule.title).toEqual([]);
    }
  });
});
