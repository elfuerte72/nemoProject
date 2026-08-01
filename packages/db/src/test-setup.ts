import { migrateTestDatabase } from './testing.js';

/**
 * Схема тестовой базы приводится в порядок один раз на прогон, а не
 * перед каждым файлом: миграции идут дольше самих тестов.
 */
export async function setup(): Promise<void> {
  await migrateTestDatabase();
}
