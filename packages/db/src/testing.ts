import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase, type Database } from './index.js';

/**
 * Обвязка тестов, работающих против настоящего Postgres.
 *
 * Настоящая база, а не мок репозитория: значимая часть гарантий сервиса
 * выражена ограничениями самой базы — обязательность дохода при
 * исполнении заявки, уникальность начисления по паре «заявка и линия»,
 * запрет самореферала. Мок эти правила не проверит, а именно они
 * защищают деньги.
 *
 * База отдельная от базы разработки: между тестами данные вычищаются, и
 * делать это с тем, что разработчик наполнил руками, недопустимо.
 */

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgres://nemo:nemo@localhost:5432/nemo_test';
}

let instance: Database | undefined;

/**
 * Подключение к тестовой базе, одно на процесс. Тесты идут
 * последовательно, поэтому пул больше одного соединения не нужен.
 */
export function testDatabase(): Database {
  instance ??= createDatabase(testDatabaseUrl());
  return instance;
}

export async function closeTestDatabase(): Promise<void> {
  if (!instance) return;
  await instance.$client.end();
  instance = undefined;
}

/** Привести тестовую базу к схеме. Вызывается один раз перед прогоном. */
export async function migrateTestDatabase(): Promise<void> {
  const db = createDatabase(testDatabaseUrl());
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await db.$client.end();
  }
}

/**
 * Очистить данные, оставив схему. `cascade` вместо ручного порядка
 * удаления: порядок пришлось бы править при каждой новой связи, а
 * забытая правка проявилась бы как падение постороннего теста.
 *
 * Настройки сервиса создаются заново со значениями по умолчанию: их
 * строка — часть схемы, операции читают её без проверки на существование.
 */
export async function resetDatabase(db: Database = testDatabase()): Promise<void> {
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (tables.length === 0) {
    throw new Error(
      'В тестовой базе нет таблиц: не применены миграции. ' +
        'Проверьте, что Postgres поднят (docker compose up -d).',
    );
  }
  const list = sql.join(
    tables.map((table) => sql.identifier(table.tablename)),
    sql`, `,
  );
  await db.execute(sql`truncate table ${list} restart identity cascade`);
  await db.execute(sql`insert into service_settings default values`);
}
