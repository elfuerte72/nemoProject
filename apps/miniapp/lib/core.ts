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

let instance: Core | undefined;

export function getCore(): Core {
  if (instance) return instance;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Не задан DATABASE_URL');
  }

  const concierge = conciergeFromEnvironment();
  instance = createCore({
    db: createDatabase(url),
    requisites: { publicKey: process.env.REQUISITES_PUBLIC_KEY },
    rateSource: ratesFromEnvironment(),
    ...(concierge ? { concierge } : {}),
  });
  return instance;
}
