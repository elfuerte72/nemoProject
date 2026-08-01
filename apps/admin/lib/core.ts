import { createCore, createDatabase, type Core } from '@nemo/core';

/**
 * Модуль операций для админ-панели.
 *
 * Здесь, и только здесь, есть приватный ключ: расшифровать номер карты
 * клиента можно исключительно в этом деплое (docs/adr/0002). Отдельное
 * приложение существует ровно ради этого — иначе ключ ехал бы туда же,
 * куда и клиентская часть.
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
    requisites: {
      publicKey: process.env.REQUISITES_PUBLIC_KEY,
      privateKey: process.env.REQUISITES_PRIVATE_KEY,
    },
  });
  return instance;
}
