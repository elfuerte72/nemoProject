import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };

export type Database = ReturnType<typeof createDatabase>;

/**
 * Подключение к базе.
 *
 * `max: 1` по умолчанию — приложения разворачиваются на serverless, где
 * каждый экземпляр живёт недолго и держать пул соединений некому. Для
 * долгоживущих процессов (миграции, скрипты) значение переопределяется.
 */
export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(url, {
    max: options.max ?? 1,
    // numeric приходит строкой: через number он потерял бы точность.
    types: {
      bigint: postgres.BigInt,
    },
  });
  return drizzle(client, { schema, casing: 'snake_case' });
}
