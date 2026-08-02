import { settingsAuditLog } from '@nemo/db';
import type { Executor } from './context.js';

/**
 * Запись в журнал настроек.
 *
 * Отдельным модулем, а не частью управления сотрудниками: настройки
 * правятся из нескольких мест — экономика, сети, заготовки текстов, — и
 * журнал у них один. Вопрос «кто поменял это число» задают о сервисе
 * целиком, а не о разделе панели.
 *
 * Что изменилось, хранится документом: настройки разнородны, и колонка
 * под каждую означала бы правку схемы при каждой новой.
 */
export async function recordSettingsChange(
  executor: Executor,
  staffId: string,
  subject: string,
  subjectId: string | null,
  changes: Record<string, unknown>,
): Promise<void> {
  await executor.insert(settingsAuditLog).values({ staffId, subject, subjectId, changes });
}
