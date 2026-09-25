import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { V1_ERRORS, V1_RESPONSE_HEADERS } from './reference';
import { toApiRequest, toApiRequisites } from './views';

/**
 * Договор API — файл OpenAPI, и он обязан сходиться с маршрутами
 * приложения: вики расходится с кодом через месяц, а этот файл читает
 * мерчант, встраивающий сервис в свою систему.
 *
 * Сверяются пути и методы в обе стороны, и у каждого ответа есть
 * пример: пример — то, по чему пишут разбор ответа, не открывая
 * сервер.
 */

const ROOT = join(import.meta.dirname, '../..');
const ROUTES = join(ROOT, 'app/api/v1');
const SPEC = join(ROOT, '../../docs/api/merchant-v1.yaml');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Маршруты приложения: путь в терминах OpenAPI и его методы. */
function appRoutes(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (name !== 'route.ts') continue;

      const path =
        '/' +
        relative(ROUTES, dir)
          .split('/')
          .map((segment) => segment.replace(/^\[(.+)\]$/, '{$1}'))
          .join('/');
      const source = readFileSync(full, 'utf8');
      const methods = new Set<string>();
      for (const method of METHODS) {
        if (new RegExp(`^export const ${method.toUpperCase()} = `, 'm').test(source)) {
          methods.add(method);
        }
      }
      found.set(path, methods);
    }
  };
  walk(ROUTES);
  return found;
}

interface Spec {
  info: { description: string };
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { responses: Record<string, unknown> };
}

function exampleAt(path: string, method: string, status: string): Record<string, unknown> {
  const response = spec.paths[path]![method]!.responses[status] as {
    content: Record<string, { example: Record<string, unknown> }>;
  };
  return response.content['application/json']!.example;
}

const spec = parse(readFileSync(SPEC, 'utf8')) as Spec;

describe('договор API', () => {
  it('описывает каждый маршрут приложения — и ни одного лишнего', () => {
    const routes = appRoutes();
    const described = new Map(
      Object.entries(spec.paths).map(([path, methods]) => [
        path,
        new Set(Object.keys(methods).filter((one) => (METHODS as readonly string[]).includes(one))),
      ]),
    );

    const flatten = (map: Map<string, Set<string>>) =>
      [...map.entries()]
        .flatMap(([path, methods]) => [...methods].map((method) => `${method.toUpperCase()} ${path}`))
        .sort();

    expect(flatten(described)).toEqual(flatten(routes));
  });

  /**
   * Пример — то, по чему пишут разбор ответа, не открывая сервер.
   * Поле, переименованное в виде и не тронутое в примере, ломало бы
   * чужой код молча — поэтому набор ключей сверяется с тем, что
   * собирает приложение.
   */
  it('примеры повторяют форму ответов приложения', () => {
    const now = new Date('2026-09-07T10:00:00Z');
    const request = toApiRequest(
      {
        id: 'r',
        owner: { kind: 'merchant', merchantId: 'm' },
        kind: 'electronic',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100' as never,
        toAmount: null,
        requestRate: null,
        finalRate: null,
        status: 'new',
        requisitesIssuedAt: null,
        requisitesId: null,
        paymentInstructions: null,
        cancelReason: null,
        reference: null,
        submittedByUserId: null,
        source: 'api',
        apiKeyId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      { unpaidTtlMinutes: 120 },
    );
    const requisites = toApiRequisites({
      id: 'q',
      kind: 'wallet',
      bankName: null,
      phone: null,
      cardLast4: null,
      network: 'TRC20',
      addressHint: 'TQmX…aU6e',
      holderName: null,
      accountLast4: null,
      qrHint: null,
      promptpayIdType: null,
      alipayAccount: null,
      isAvailable: true,
      createdAt: now,
    });

    const keys = (value: unknown) => Object.keys(value as object).sort();
    expect(keys(exampleAt('/exchange-requests/{id}', 'get', '200')['request'])).toEqual(
      keys(request),
    );
    expect(keys(exampleAt('/exchange-requests', 'post', '201')['request'])).toEqual(keys(request));
    expect(keys(exampleAt('/requisites', 'post', '201')['requisites'])).toEqual(
      keys(requisites),
    );
  });

  it('у каждого ответа есть пример', () => {
    const missing: string[] = [];
    const hasExample = (response: unknown): boolean => {
      if (typeof response !== 'object' || response === null) return false;
      if ('$ref' in response) return true; // общие ответы проверяются ниже
      const content = (response as { content?: Record<string, { example?: unknown }> }).content;
      return content !== undefined && Object.values(content).every((one) => 'example' in one);
    };

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        for (const [status, response] of Object.entries(operation.responses)) {
          if (!hasExample(response)) missing.push(`${method.toUpperCase()} ${path} ${status}`);
        }
      }
    }
    for (const [name, response] of Object.entries(spec.components.responses)) {
      if (!hasExample(response)) missing.push(`components.responses.${name}`);
    }

    expect(missing).toEqual([]);
  });

  /*
   * Код отказа — то, по чему разбирает ответ чужой код. Код, который
   * адаптер отдаёт, а договор не называет, мерчант впервые увидит в
   * проде; справка на странице «Документация» и договор обязаны
   * называть одно и то же.
   */
  it('называет каждый код отказа адаптера — тот же набор, что справка', () => {
    const named = [...spec.info.description.matchAll(/`([a-z_]+)`/g)]
      .map((match) => match[1]!)
      .filter((word) => word in V1_ERRORS);
    expect(new Set(named)).toEqual(new Set(Object.keys(V1_ERRORS)));
  });

  it('называет заголовки ответа, которые описывает справка', () => {
    for (const header of V1_RESPONSE_HEADERS) {
      expect(spec.info.description, header.name).toContain(header.name);
    }
  });

  it('у каждой операции описаны отказы по адресу и по пределу', () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(Object.keys(operation.responses), `${method} ${path}`).toEqual(
          expect.arrayContaining(['401', '403', '429']),
        );
      }
    }
  });
});
