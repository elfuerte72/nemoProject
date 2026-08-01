import { getClient, registerClient, type RegisterClientInput } from './clients.js';
import { toContext, type CoreConfig } from './context.js';

/**
 * Прикладные операции сервиса — единственное место, где меняется его
 * состояние.
 *
 * Оба приложения — тонкие адаптеры: маршрут разбирает запрос, вызывает
 * операцию, отдаёт результат. Ни Mini App, ни админка не пишут в базу
 * напрямую. Иначе правило вроде «баллы начисляются при исполнении
 * заявки» пришлось бы повторять в каждом месте, откуда заявку можно
 * исполнить, и рано или поздно одно из них отстало бы.
 *
 * Интерфейс — операции, а не таблицы: «подать заявку», а не
 * «вставить строку в exchange_requests». Каждая операция принимает
 * данные и того, кто её выполняет, и сама решает, разрешено ли действие.
 */
export function createCore(config: CoreConfig) {
  const ctx = toContext(config);

  return {
    registerClient: (input: RegisterClientInput) => registerClient(ctx, input),
    getClient: (telegramUserId: bigint) => getClient(ctx, telegramUserId),
  };
}

export type Core = ReturnType<typeof createCore>;

/**
 * Подключение к базе реэкспортируется отсюда, чтобы приложения не
 * зависели от `@nemo/db` вовсе: пакет со схемой — деталь реализации
 * операций, и импорт таблицы в маршруте должен быть заметен как
 * посторонняя зависимость, а не выглядеть обычным делом.
 */
export { createDatabase, type Database } from '@nemo/db';

export type { Actor } from './actor.js';
export type { CoreConfig } from './context.js';
export type {
  ClientView,
  RegisterClientInput,
  RegisterClientResult,
} from './clients.js';
export {
  ConflictError,
  CoreError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  TransitionNotAllowedError,
  type CoreErrorCode,
} from './errors.js';
export { renderNotification, type Notification } from './notifications.js';
