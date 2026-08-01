import { createCore, createDatabase, type Core } from '@nemo/core';

/**
 * Модуль операций для клиентского приложения.
 *
 * Публичный ключ реквизитов сюда передаётся, приватный — нет, и это не
 * упущение: клиентский деплой должен уметь записать номер карты и не
 * уметь прочитать (docs/adr/0002). Операции, требующие расшифровки,
 * здесь отказывают, потому что ключа физически нет.
 */

let instance: Core | undefined;

export function getCore(): Core {
  if (instance) return instance;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Не задан DATABASE_URL');
  }

  instance = createCore({
    db: createDatabase(url),
    requisites: { publicKey: process.env.REQUISITES_PUBLIC_KEY },
  });
  return instance;
}
