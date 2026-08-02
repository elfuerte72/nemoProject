import { createDatabase } from '@nemo/core';
import { currencies, currencyPairs } from '@nemo/db';

/**
 * Завести направления обмена в развёрнутой базе.
 *
 * Скрипт, а не операция ядра и не экран администратора: каким будет
 * справочник валют, зависит от ответа заказчика по блокеру C1 — сколько
 * валют, какие пары, откуда котировки. Операция, спроектированная до
 * ответа, окажется не той, и убирать её будет дороже, чем этот скрипт.
 * Наценку у заведённых направлений администратор уже настраивает сам.
 *
 * Повторный запуск ничего не ломает: валюты и направления добавляются
 * только те, которых ещё нет.
 *
 * Запуск: pnpm seed-currency-pairs
 */

const CURRENCIES = [
  { code: 'RUB', decimals: 2, kind: 'fiat' as const },
  { code: 'USDT', decimals: 6, kind: 'crypto' as const },
  { code: 'BTC', decimals: 8, kind: 'crypto' as const },
];

/**
 * Наценка 2% — значение для проверки, а не решение о доходности:
 * настоящие ставки задаёт администратор в разделе настроек (блокер B1).
 */
const MARKUP_BPS = 200;

/**
 * Направление — это пара плюс способ, и оно одностороннее: «отдаю USDT,
 * получаю рубли» и «отдаю рубли, получаю USDT» — две разные строки с
 * разной наценкой. Обмен работает в обе стороны только если заведены обе.
 */
const PAIRS = [
  { fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' as const },
  { fromCode: 'USDT', toCode: 'RUB', kind: 'cash' as const },
  { fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' as const },
  { fromCode: 'RUB', toCode: 'USDT', kind: 'cash' as const },
  { fromCode: 'BTC', toCode: 'RUB', kind: 'electronic' as const },
  { fromCode: 'BTC', toCode: 'RUB', kind: 'cash' as const },
  { fromCode: 'RUB', toCode: 'BTC', kind: 'electronic' as const },
  { fromCode: 'RUB', toCode: 'BTC', kind: 'cash' as const },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Не задан DATABASE_URL');
    process.exitCode = 1;
    return;
  }

  const db = createDatabase(url);
  try {
    for (const currency of CURRENCIES) {
      await db.insert(currencies).values(currency).onConflictDoNothing();
    }

    for (const pair of PAIRS) {
      await db
        .insert(currencyPairs)
        .values({ ...pair, markupBps: MARKUP_BPS })
        .onConflictDoNothing({
          target: [currencyPairs.fromCode, currencyPairs.toCode, currencyPairs.kind],
        });
      console.log(`${pair.fromCode} → ${pair.toCode} (${pair.kind})`);
    }

    console.log(`Готово. Наценка ${MARKUP_BPS} bps — поменяйте её в разделе настроек.`);
  } finally {
    await db.$client.end();
  }
}

await main();
