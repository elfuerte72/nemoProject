import { parse } from 'yaml';
import source from '../../../docs/api/merchant-v1.yaml';

/** Сам файл — его отдаёт маршрут `/api/docs/openapi.yaml`. */
export const apiDocSource: string = source;

/**
 * Договор API — из того же файла, который сверяет тест с маршрутами.
 *
 * Файл едет в бандл строкой на сборке: страница «Документация» не ходит
 * за ним на диск, а значит показывает ровно ту версию, с которой
 * собрано приложение. Разбирается ровно то, что страница показывает:
 * операции, параметры, примеры. Полный разбор OpenAPI сюда не
 * переезжает — документация одна и своя.
 */

export interface DocParameter {
  readonly name: string;
  readonly where: string;
  readonly required: boolean;
  readonly description: string | null;
}

export interface DocResponse {
  readonly status: string;
  readonly description: string;
  readonly example: unknown;
}

export interface DocOperation {
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly description: string | null;
  readonly tag: string;
  readonly parameters: readonly DocParameter[];
  readonly requestExample: unknown;
  readonly responses: readonly DocResponse[];
}

export interface DocTag {
  readonly name: string;
  readonly description: string;
}

export interface ApiDoc {
  readonly title: string;
  readonly intro: string;
  readonly tags: readonly DocTag[];
  readonly operations: readonly DocOperation[];
}

type Raw = Record<string, unknown>;

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function asRecord(value: unknown): Raw {
  return typeof value === 'object' && value !== null ? (value as Raw) : {};
}

function resolve(spec: Raw, value: unknown): Raw {
  const record = asRecord(value);
  const ref = record['$ref'];
  if (typeof ref !== 'string') return record;
  const path = ref.replace(/^#\//, '').split('/');
  let cursor: unknown = spec;
  for (const segment of path) {
    cursor = asRecord(cursor)[segment];
  }
  return asRecord(cursor);
}

function exampleOf(spec: Raw, holder: unknown): unknown {
  const content = asRecord(resolve(spec, holder)['content']);
  const json = asRecord(content['application/json']);
  return json['example'];
}

export function loadApiDoc(): ApiDoc {
  const spec = asRecord(parse(source));
  const info = asRecord(spec['info']);
  const tags = (spec['tags'] as readonly Raw[] | undefined) ?? [];

  const operations: DocOperation[] = [];
  for (const [path, methods] of Object.entries(asRecord(spec['paths']))) {
    for (const [method, raw] of Object.entries(asRecord(methods))) {
      if (!METHODS.includes(method)) continue;
      const operation = asRecord(raw);
      const parameters = ((operation['parameters'] as readonly unknown[] | undefined) ?? []).map(
        (one) => {
          const parameter = resolve(spec, one);
          return {
            name: String(parameter['name']),
            where: String(parameter['in']),
            required: parameter['required'] === true,
            description:
              typeof parameter['description'] === 'string' ? parameter['description'] : null,
          };
        },
      );
      const responses = Object.entries(asRecord(operation['responses'])).map(
        ([status, response]) => {
          const resolved = resolve(spec, response);
          return {
            status,
            description: String(resolved['description'] ?? ''),
            example: exampleOf(spec, response),
          };
        },
      );
      operations.push({
        method: method.toUpperCase(),
        path,
        summary: String(operation['summary'] ?? ''),
        description:
          typeof operation['description'] === 'string' ? operation['description'].trim() : null,
        tag: String((operation['tags'] as readonly string[] | undefined)?.[0] ?? ''),
        parameters,
        requestExample: exampleOf(spec, operation['requestBody']),
        responses,
      });
    }
  }

  return {
    title: String(info['title'] ?? 'API'),
    intro: String(info['description'] ?? '').trim(),
    tags: tags.map((tag) => ({
      name: String(tag['name']),
      description: String(tag['description'] ?? ''),
    })),
    operations,
  };
}
