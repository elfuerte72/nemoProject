import { notInArray, or } from 'drizzle-orm';
import { createDatabase } from '@nemo/core';
import { currencies, currencyPairs, transferNetworks } from '@nemo/db';

/**
 * Привести справочники в развёрнутой базе к тому, чем сервис торгует и
 * куда он отправляет.
 *
 * Скрипт, а не операция ядра и не экран администратора: состав
 * справочника — решение о том, чем сервис торгует, и меняется оно реже,
 * чем раз в заход. Операция под него завелась бы ради работы, которую
 * никто не делает. Гасить и включать сети администратор при этом может
 * из панели: это уже не состав справочника, а рабочее состояние.
 *
 * Сервис работает с одной парой — USDT и рубль — в обе стороны,
 * безналично и наличными. Прочие валюты скрипт удаляет: экран не должен
 * предлагать выбор, за которым не стоит работающего направления, а
 * данные в развёрнутой базе тестовые — переносить нечего.
 *
 * Заявки на удаление не смотрят: код валюты хранится в них строкой, а
 * не ссылкой, и поданная когда-то заявка остаётся читаемой. Сети,
 * наоборот, хранятся ссылкой — лишние скрипт не удаляет, а гасит: на них
 * ссылаются прошлые заявки и сохранённые реквизиты.
 *
 * Повторный запуск ничего не ломает: справочники каждый раз приводятся к
 * одному и тому же состоянию.
 *
 * Запуск: pnpm seed-directories
 */

const CURRENCIES = [
  { code: 'RUB', decimals: 2, kind: 'fiat' as const },
  { code: 'USDT', decimals: 6, kind: 'crypto' as const },
];

/**
 * Направление — это пара плюс способ, и оно одностороннее: «отдаю USDT,
 * получаю рубли» и «отдаю рубли, получаю USDT» — две разные строки.
 * Обмен работает в обе стороны только если заведены обе.
 *
 * Наценки у направления нет: она одна на весь сервис и живёт в его
 * настройках, где её задаёт администратор.
 */
const PAIRS = [
  { fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' as const },
  { fromCode: 'USDT', toCode: 'RUB', kind: 'cash' as const },
  { fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' as const },
  { fromCode: 'RUB', toCode: 'USDT', kind: 'cash' as const },
];

/**
 * Сети, в которых сервис принимает и отправляет USDT. Справочник общий:
 * из него берут сеть и реквизиты обмена, и заявки на вывод.
 */
const NETWORKS = ['TRC20', 'TON'];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Не задан DATABASE_URL');
    process.exitCode = 1;
    return;
  }

  const db = createDatabase(url);
  const codes = CURRENCIES.map((currency) => currency.code);

  try {
    for (const currency of CURRENCIES) {
      await db.insert(currencies).values(currency).onConflictDoNothing();
    }

    for (const pair of PAIRS) {
      await db
        .insert(currencyPairs)
        .values(pair)
        .onConflictDoNothing({
          target: [currencyPairs.fromCode, currencyPairs.toCode, currencyPairs.kind],
        });
      console.log(`${pair.fromCode} → ${pair.toCode} (${pair.kind})`);
    }

    // Направления удаляются раньше валют: справочник валют они держат
    // ссылкой, и обратный порядок упёрся бы в неё. Направление лишнее,
    // если чужая хотя бы одна его сторона.
    const droppedPairs = await db
      .delete(currencyPairs)
      .where(
        or(notInArray(currencyPairs.fromCode, codes), notInArray(currencyPairs.toCode, codes)),
      )
      .returning({ id: currencyPairs.id });
    const droppedCurrencies = await db
      .delete(currencies)
      .where(notInArray(currencies.code, codes))
      .returning({ code: currencies.code });

    if (droppedPairs.length > 0 || droppedCurrencies.length > 0) {
      console.log(
        `Убрано лишнего: направлений ${droppedPairs.length}, ` +
          `валют ${droppedCurrencies.length} ` +
          `(${droppedCurrencies.map((one) => one.code).join(', ')})`,
      );
    }

    for (const code of NETWORKS) {
      // Уже заведённая сеть включается обратно: скрипт объявляет, с чем
      // сервис работает, и после него справочник в одном и том же виде
      // независимо от того, что в нём стояло раньше.
      await db
        .insert(transferNetworks)
        .values({ code })
        .onConflictDoUpdate({ target: transferNetworks.code, set: { isActive: true } });
      console.log(`сеть ${code}`);
    }

    // Лишние сети гасятся, а не удаляются: на них ссылаются прошлые
    // заявки на вывод и сохранённые реквизиты, и удаление упёрлось бы в
    // эти ссылки.
    const disabled = await db
      .update(transferNetworks)
      .set({ isActive: false })
      .where(notInArray(transferNetworks.code, NETWORKS))
      .returning({ code: transferNetworks.code });

    if (disabled.length > 0) {
      console.log(`Погашено сетей: ${disabled.map((one) => one.code).join(', ')}`);
    }

    console.log('Готово. Наценку и минимальную сумму обмена задайте в разделе настроек.');
  } finally {
    await db.$client.end();
  }
}

await main();
