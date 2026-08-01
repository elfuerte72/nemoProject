import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
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

const DEFAULT_TEST_DATABASE_URL = 'postgres://nemo:nemo@localhost:5432/nemo_test';

/**
 * У каждого пакета своя тестовая база: `nemo_test_core`, `nemo_test_db`.
 *
 * Turbo запускает пакеты параллельно, и общая база означала бы, что
 * тесты вычищают данные друг у друга — падения при этом выглядят как
 * ошибки в коде, хотя код ни при чём. Имя пакета даёт разделение
 * автоматически, без ручного списка баз.
 */
export function testDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const packageName = process.env.npm_package_name?.replace(/^@nemo\//, '');
  if (!packageName) {
    return base;
  }
  const url = new URL(base);
  url.pathname = `/${url.pathname.slice(1)}_${packageName.replace(/\W/g, '_')}`;
  return url.toString();
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
  const url = testDatabaseUrl();
  await ensureDatabaseExists(url);

  const db = createDatabase(url);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await db.$client.end();
  }
}

/**
 * Создать базу пакета, если её ещё нет. Раз имя выводится из имени
 * пакета, требовать от разработчика заводить её руками означало бы
 * ломать прогон при каждом новом пакете.
 */
async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));

  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const client = postgres(maintenance.toString(), { max: 1 });
  try {
    const existing = await client`select 1 from pg_database where datname = ${name}`;
    if (existing.length === 0) {
      // `create database` не принимает параметров, поэтому имя
      // экранируется как идентификатор. Оно собрано из имени пакета и
      // ниоткуда больше, но подставлять в SQL как есть — привычка,
      // которая однажды доберётся до данных пользователя.
      await client.unsafe(`create database ${escapeIdentifier(name)}`);
    }
  } finally {
    await client.end();
  }
}

function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
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
