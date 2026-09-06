import { createCore, createDatabase, type Core } from '@nemo/core';

/**
 * Модуль операций кабинета мерчанта.
 *
 * Клиентский контур: приватного ключа реквизитов здесь нет и быть не
 * может (docs/adr/0002). Мерчант заводит реквизиты получателя и видит
 * свои заявки, но расшифровать номер карты можно только в панели —
 * ровно как у клиента в Mini App.
 *
 * Экземпляр держится на `globalThis`, а не в переменной модуля: Next
 * пересобирает модули в разработке на каждую правку, и с переменной у
 * каждой сборки был бы свой пул соединений. То же правило у Mini App и
 * у панели.
 */

const KEY = Symbol.for('nemo.cabinet.core');

type Holder = typeof globalThis & { [KEY]?: Core };

export function getCore(): Core {
  const holder = globalThis as Holder;
  if (holder[KEY]) return holder[KEY];

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Не задан DATABASE_URL');
  }

  holder[KEY] = createCore({
    db: createDatabase(url),
    requisites: { publicKey: process.env.REQUISITES_PUBLIC_KEY },
  });
  return holder[KEY];
}
