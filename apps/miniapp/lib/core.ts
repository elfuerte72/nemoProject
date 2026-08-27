import { conciergeFromEnvironment } from '@nemo/concierge';
import { createCore, createDatabase, type Core } from '@nemo/core';
import { ratesFromEnvironment } from '@nemo/rates';

/**
 * Модуль операций для клиентского приложения.
 *
 * Публичный ключ реквизитов сюда передаётся, приватный — нет, и это не
 * упущение: клиентский деплой должен уметь записать номер карты и не
 * уметь прочитать (docs/adr/0002). Операции, требующие расшифровки,
 * здесь отказывают, потому что ключа физически нет.
 *
 * Источник котировок задаётся здесь же: какие именно провайдеры стоят за
 * котировками и сколько их — свойство развёртывания, и заявка на обмен
 * о них не знает.
 *
 * Тем же порядком заводится консьерж. Ключа провайдера нет — нет и
 * первой линии: клиенту тогда отвечает человек, как было до неё. Это
 * рабочее состояние, а не поломка, и выключается консьерж снятием
 * ключа. У админки его нет вовсе: разговор ведёт клиентский деплой,
 * потому что бот, которого клиент запускал, живёт там.
 */

/**
 * Ядро одно на процесс, и держится оно на `globalThis`, а не в
 * переменной модуля.
 *
 * Next собирает `instrumentation.ts` и маршруты в разные бандлы, и у
 * каждого свой экземпляр этого модуля со своей переменной. С ней ядер
 * выходило два: одно заводил хук прогрева при старте, и его никто не
 * спрашивал, второе — первый же маршрут, и грелось оно на первом
 * клиенте, то есть ровно так, как до хука. Замечено 27 августа 2026
 * по десяти таймерам кэшей курса в процессе вместо пяти. Ключ —
 * строка на `globalThis`: два бандла должны сойтись на одном имени, а
 * не на одном объекте-символе.
 */
const CORE_KEY = '__nemoMiniappCore';
type CoreHolder = { [CORE_KEY]?: Core };

export function getCore(): Core {
  const holder = globalThis as typeof globalThis & CoreHolder;
  const shared = holder[CORE_KEY];
  if (shared) return shared;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Не задан DATABASE_URL');
  }

  const concierge = conciergeFromEnvironment();
  const instance = createCore({
    db: createDatabase(url),
    requisites: { publicKey: process.env.REQUISITES_PUBLIC_KEY },
    rateSource: ratesFromEnvironment(),
    ...(concierge ? { concierge } : {}),
  });
  holder[CORE_KEY] = instance;
  return instance;
}
