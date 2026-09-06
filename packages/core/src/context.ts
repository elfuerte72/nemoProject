import type { Database } from '@nemo/db';
import type { ConciergeSource } from './concierge-source.js';
import type { KnowledgeDrafter } from './knowledge-drafter.js';
import type { RateSource } from './rates.js';

/**
 * Всё, что операциям нужно снаружи: база, ключи шифрования реквизитов и
 * источник котировок.
 *
 * Ключи разные у двух приложений, и это существенно. Клиентский деплой
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
  /**
   * Откуда берутся котировки. Не задан — курса нет, и это
   * рабочее состояние: наличные обходятся без него вовсе, а по
   * электронным переводам экран честно скажет, что курс назовёт
   * менеджер.
   */
  readonly rateSource?: RateSource | undefined;
  /**
   * Кто отвечает клиенту первым. Не задан — первой линии нет, и
   * сообщение клиента идёт сотрудникам, как было до консьержа. Это
   * рабочее состояние, а не поломка: у админки его нет вовсе, а в
   * клиентском деплое он выключается снятием ключа провайдера.
   */
  readonly concierge?: ConciergeSource | undefined;
  /**
   * Кто делит документ администратора на статьи базы знаний. Не задан —
   * разбор документов выключен, а статьи заводятся руками: это рабочее
   * состояние деплоя без ключа провайдера, а не поломка. Нужен панели,
   * а консьерж — клиентскому приложению; ключ у них один.
   */
  readonly knowledgeDrafter?: KnowledgeDrafter | undefined;
  /**
   * Сколько миллисекунд тишины консьерж ждёт, прежде чем взять череду.
   * Человек пишет мысль несколькими сообщениями, и ответ на каждое —
   * разговор с автоответчиком. Не задано — берётся срок по умолчанию;
   * ноль выключает паузу (так живут тесты, которым ждать нечего).
   */
  readonly conciergeQuietMs?: number | undefined;
}

/**
 * Отсутствие ключа — ошибка развёртывания, а не отказ по правилу
 * предметной области: клиент ничего не сделал не так, и сообщать ему
 * нечего. Поэтому обычная `Error`, а не `CoreError`.
 */
export function requirePublicKey(config: CoreConfig): string {
  const key = config.requisites?.publicKey;
  if (!key) {
    throw new Error('Не задан публичный ключ шифрования реквизитов');
  }
  return key;
}

export function requirePrivateKey(config: CoreConfig): string {
  const key = config.requisites?.privateKey;
  if (!key) {
    throw new Error('Не задан приватный ключ расшифровки реквизитов');
  }
  return key;
}

/**
 * База или транзакция. Операции, которые могут быть частью большей
 * транзакции, принимают этот тип, а не `Database`.
 */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
