import { knowledgeDrafterFromEnvironment } from '@nemo/concierge';
import { createCore, createDatabase, type Core } from '@nemo/core';

/**
 * Модуль операций для админ-панели.
 *
 * Здесь, и только здесь, есть приватный ключ: расшифровать номер карты
 * клиента можно исключительно в этом деплое (docs/adr/0002). Отдельное
 * приложение существует ровно ради этого — иначе ключ ехал бы туда же,
 * куда и клиентская часть.
 *
 * Экземпляр держится на `globalThis`, а не в переменной модуля: в
 * разработке Next пересобирает модуль на каждую правку, и переменная
 * обнулялась бы вместе с ним — с новым пулом соединений на каждую
 * сборку. За час правок так набралось девяносто соединений к базе, и
 * она перестала принимать новые. То же правило у Mini App.
 *
 * Консьержа здесь нет — разговор с клиентом ведёт клиентский деплой, —
 * но провайдер модели тот же и нужен панели для другого: разложить
 * документ администратора на статьи базы знаний. Ключа нет — разбор
 * выключен, статьи заводятся руками; это рабочее состояние.
 */

const KEY = Symbol.for('nemo.admin.core');

type Holder = typeof globalThis & { [KEY]?: Core };

export function getCore(): Core {
  const holder = globalThis as Holder;
  if (holder[KEY]) return holder[KEY];

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Не задан DATABASE_URL');
  }

  const knowledgeDrafter = knowledgeDrafterFromEnvironment();
  holder[KEY] = createCore({
    db: createDatabase(url),
    requisites: {
      publicKey: process.env.REQUISITES_PUBLIC_KEY,
      privateKey: process.env.REQUISITES_PRIVATE_KEY,
    },
    ...(knowledgeDrafter ? { knowledgeDrafter } : {}),
  });
  return holder[KEY];
}
