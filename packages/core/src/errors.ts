/**
 * Ошибки прикладных операций.
 *
 * У каждой есть код: адаптеры переводят его в ответ протокола — HTTP
 * для маршрута, текст для бота, — и делают это по коду, а не по тексту
 * сообщения.
 *
 * Текст обращён к тому, кто вызвал операцию, и показывается ему как
 * есть: «укажите причину отмены» человек прочитает и исправит, а
 * «invalid input» — нет. Разбирать текст в коде нельзя: он меняется
 * свободно, код отказа — нет.
 */

export type CoreErrorCode =
  /** Запрошенного объекта нет — или он есть, но не у этого клиента. */
  | 'not-found'
  /** Действие существует, но этому исполнителю не разрешено. */
  | 'forbidden'
  /** Данные не проходят правило предметной области. */
  | 'invalid-input'
  /** Переход не описан в таблице состояний. */
  | 'transition-not-allowed'
  /** Кто-то успел раньше: заявку уже взяли, состояние уже изменилось. */
  | 'conflict';

export class CoreError extends Error {
  constructor(
    readonly code: CoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends CoreError {
  constructor(message: string) {
    super('not-found', message);
  }
}

export class ForbiddenError extends CoreError {
  constructor(message: string) {
    super('forbidden', message);
  }
}

export class InvalidInputError extends CoreError {
  constructor(message: string) {
    super('invalid-input', message);
  }
}

export class TransitionNotAllowedError extends CoreError {
  constructor(message: string) {
    super('transition-not-allowed', message);
  }
}

export class ConflictError extends CoreError {
  constructor(message: string) {
    super('conflict', message);
  }
}
