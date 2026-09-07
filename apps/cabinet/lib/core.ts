import { createCore, createDatabase, type Core } from '@nemo/core';
import { ratesFromEnvironment } from '@nemo/rates';

/**
 * Модуль операций кабинета мерчанта.
 *
 * Клиентский контур: приватного ключа реквизитов здесь нет и быть не
 * может (docs/adr/0002). Мерчант заводит реквизиты получателя и видит
 * свои заявки, но расшифровать номер карты можно только в панели —
 * ровно как у клиента в Mini App.
 *
 * Источник котировок — тот же, что у Mini App, из тех же переменных:
 * курс заявки, поданной по API, — такое же обязательство сервиса, как
 * у поданной с экрана, и назначать его должен один и тот же путь.
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
    rateSource: ratesFromEnvironment(),
    // `sk_live_` на боевом, `sk_test_` на песочнице: не задан — выпуск
    // ключа отвечает ошибкой развёртывания, а не отказом мерчанту.
    apiKeyPrefix: process.env.API_KEY_PREFIX,
  });
  return holder[KEY];
}
