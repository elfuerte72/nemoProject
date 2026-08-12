import { createDatabase } from '@nemo/core';
import { feeScheduleTiers, feeSchedules } from '@nemo/db';

/**
 * Завести сетки комиссии из ТЗ владельца.
 *
 * Скрипт, а не операция ядра: до появления экрана правки (тикет 13)
 * ставки надо чем-то занести, а письма с ними приходят по одному на
 * направление. Правку из панели он не затрёт — заведённую сетку
 * пропускает целиком, как сид базы знаний пропускает занятую статью.
 *
 * Ставки взяты из таблиц п. 3 каждого письма, а не из формулы п. 6:
 * разбор противоречия — в `.scratch/exchange-pricing/spec.md`. Ступень
 * берётся от всей суммы, пороги в долларах.
 *
 * Запуск: pnpm seed-fee-schedules
 */

/**
 * Сетки по письмам владельца от 10 и 12 августа 2026.
 *
 * У бата ступеней четыре, у юаня три — это не описка, а разная
 * экономика направлений. Валюты, на которые письма не приходили, здесь
 * не заводятся вовсе: они считаются наценкой сервиса, и назначать за
 * владельца цену бата для рупии нельзя.
 */
const SCHEDULES = [
  {
    toCode: 'THB',
    payoutMethod: 'bank' as const,
    tiers: [
      { upToUsd: '500', fixedUsd: '5' },
      { upToUsd: '2000', rateBps: 450 },
      { upToUsd: '5000', rateBps: 350 },
      { upToUsd: null, rateBps: 250 },
    ],
  },
  {
    toCode: 'THB',
    payoutMethod: 'wallet' as const,
    tiers: [
      { upToUsd: '500', fixedUsd: '10' },
      { upToUsd: '2000', rateBps: 550 },
      { upToUsd: '5000', rateBps: 450 },
      { upToUsd: null, rateBps: 350 },
    ],
  },
  {
    toCode: 'CNY',
    payoutMethod: 'wallet' as const,
    tiers: [
      { upToUsd: '500', fixedUsd: '10' },
      { upToUsd: '2000', rateBps: 200 },
      { upToUsd: null, rateBps: 100 },
    ],
  },
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
    for (const schedule of SCHEDULES) {
      /*
       * Заведённую сетку скрипт не трогает: ставки — рабочее состояние,
       * а не состав справочника. Их правит администратор по живой цене,
       * и прогон скрипта не повод отменять это молча.
       *
       * Отвечает на этот вопрос сама вставка: пустой ответ означает, что
       * сетка уже есть. Отдельная выборка перед ней была бы вторым
       * правилом о том же — и разошлась бы с ограничением базы, как
       * только у направления появится второй способ выдачи.
       */
      const [created] = await db
        .insert(feeSchedules)
        .values({ toCode: schedule.toCode, payoutMethod: schedule.payoutMethod })
        .onConflictDoNothing({ target: [feeSchedules.toCode, feeSchedules.payoutMethod] })
        .returning({ id: feeSchedules.id });

      if (!created) {
        console.log(`${schedule.toCode} (${schedule.payoutMethod}) — уже заведена, пропускаю`);
        continue;
      }

      await db.insert(feeScheduleTiers).values(
        schedule.tiers.map((tier) => ({
          scheduleId: created.id,
          upToUsd: tier.upToUsd,
          ...(tier.fixedUsd === undefined ? {} : { fixedUsd: tier.fixedUsd }),
          ...(tier.rateBps === undefined ? {} : { rateBps: tier.rateBps }),
        })),
      );

      console.log(
        `${schedule.toCode} (${schedule.payoutMethod}): ступеней ${schedule.tiers.length}`,
      );
    }

    console.log('Готово. Дальше ставки правит администратор из панели.');
  } finally {
    await db.$client.end();
  }
}

await main();
