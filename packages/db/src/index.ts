import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };

export type Database = ReturnType<typeof createDatabase>;

/**
 * Подключение к базе.
 *
 * Пул на десять соединений. Раньше здесь стояла единица с объяснением,
 * что приложения разворачиваются на serverless, где экземпляр живёт
 * недолго и держать пул некому. Это перестало быть правдой: оба
 * приложения работают долгоживущим процессом в контейнере, поднятым
 * один раз на сутки, — держать пул есть кому, а единственное соединение
 * выстраивает в очередь всех, кто пришёл одновременно. Очередь эта
 * незаметна на одном посетителе и становится узким местом ровно тогда,
 * когда посетителей много, то есть в единственный момент, который
 * имеет значение.
 *
 * Десять, а не больше: приложений два, у Postgres по умолчанию сто
 * соединений, и запас нужен миграциям и скриптам, которые приходят со
 * своим числом.
 */
export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    // numeric приходит строкой: через number он потерял бы точность.
    types: {
      bigint: postgres.BigInt,
    },
  });
  return drizzle(client, { schema, casing: 'snake_case' });
}
