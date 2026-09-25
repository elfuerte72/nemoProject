import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { requestExamples } from './api-examples';
import { SeenSignatures, verifySignature } from './v1/signature';

/**
 * Пример запроса со страницы «API» мерчант копирует как есть, и ошибка
 * в нём — это 401 на первом же вызове, найденный не нами. Node-пример
 * здесь выполняется по-настоящему: `fetch` подменён, а то, что пример
 * отправил, проверяет та же `verifySignature`, что стоит в обёртке API.
 * Python, PHP и curl проверены 24 сентября 2026 запуском против
 * локального кабинета — в CI их нечем исполнить.
 */

const KEY = 'sk_test_' + 'k'.repeat(32);

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

async function runNode(code: string): Promise<Sent> {
  let sent: Sent | undefined;
  const fakeFetch = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    sent = { url, method: init.method, headers: init.headers, body: init.body };
    return { headers: { get: () => 'req-1' }, json: async () => ({ quote: {} }) };
  };
  // Пример — модуль с `import`; здесь он исполняется телом функции, и
  // импорт заменяется теми же функциями из `node:crypto`.
  const body = code.replace("import { createHash, createHmac } from 'node:crypto';", '');
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<void>;
  const run = new AsyncFunction('createHash', 'createHmac', 'process', 'fetch', 'console', body);
  await run(createHash, createHmac, { env: { TOBEE_API_KEY: KEY } }, fakeFetch, { log: () => undefined });
  if (!sent) throw new Error('пример ничего не отправил');
  return sent;
}

function nodeExample(signed: boolean): string {
  const example = requestExamples({ origin: 'https://cabinet.example', keyHint: null, signed }).find(
    (one) => one.language === 'node',
  );
  if (!example) throw new Error('нет примера на Node.js');
  return example.code;
}

describe('пример запроса со страницы «API»', () => {
  it('подписанный Node-пример проходит проверку подписи обёртки', async () => {
    const sent = await runNode(nodeExample(true));
    const url = new URL(sent.url);

    const check = verifySignature({
      secret: KEY,
      method: sent.method,
      path: url.pathname + url.search,
      body: sent.body,
      timestamp: sent.headers['x-timestamp'] ?? null,
      signature: sent.headers['x-signature'] ?? null,
      now: new Date(),
      seen: new SeenSignatures(),
    });
    expect(check).toEqual({ ok: true });
    expect(sent.headers['x-api-key']).toBe(KEY);
  });

  it('без подписи — ключ в Authorization и то же тело', async () => {
    const sent = await runNode(nodeExample(false));
    expect(sent.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(sent.body)).toEqual({ from: 'USDT', to: 'RUB', amount: '100', side: 'from' });
  });

  it('подписанный набор без curl, обычный — с ним; у всех хвост ключа мерчанта', () => {
    const signed = requestExamples({ origin: '', keyHint: 'sk_live_…a1b2', signed: true });
    const plain = requestExamples({ origin: '', keyHint: 'sk_live_…a1b2', signed: false });
    expect(signed.map((one) => one.language)).toEqual(['node', 'python', 'php']);
    expect(plain.map((one) => one.language)).toEqual(['node', 'python', 'php', 'curl']);
    for (const example of [...signed, ...plain.filter((one) => one.language !== 'curl')]) {
      expect(example.code, example.language).toContain('sk_live_…a1b2');
    }
  });
});
