import type { Database } from '@nemo/db';

/**
 * Всё, что операциям нужно снаружи: база и ключи шифрования реквизитов.
 *
 * Ключи разные у двух приложений и это существенно. Клиентский деплой
 * получает только публичный — он может записать номер карты, но не
 * прочитать ни своих, ни чужих (docs/adr/0002). Приватный ключ есть
 * только у админки, поэтому операции, требующие расшифровки, в
 * клиентском приложении отказывают, а не «работают наполовину».
 */
export interface CoreConfig {
  readonly db: Database;
  readonly requisites?: {
    /** Шифрует реквизиты. Безопасен в клиентском деплое. */
    readonly publicKey?: string | undefined;
    /** Расшифровывает. Только в деплое админ-панели. */
    readonly privateKey?: string | undefined;
  };
}

export interface CoreContext {
  readonly db: Database;
  readonly requisites: {
    readonly publicKey: string | undefined;
    readonly privateKey: string | undefined;
  };
}

export function toContext(config: CoreConfig): CoreContext {
  return {
    db: config.db,
    requisites: {
      publicKey: config.requisites?.publicKey,
      privateKey: config.requisites?.privateKey,
    },
  };
}

/**
 * База или транзакция. Операции, которые могут быть частью большей
 * транзакции, принимают этот тип, а не `Database`.
 */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
