import { z } from 'zod';
import * as Money from './money.js';
import type { Amount } from './money.js';

/**
 * Комиссия сервиса по ступеням суммы.
 *
 * Правило владельца (ТЗ от 10 и 12 августа 2026): сумма переводится в
 * доллары, по долларовому эквиваленту выбирается ступень, ставка
 * берётся со всей суммы. Клиент долларов не видит — они нужны только
 * затем, чтобы у бата и юаня ступени считались одной линейкой.
 *
 * Живёт в доменных типах, а не в ядре: по этой же арифметике экран
 * считает сумму к выдаче, пока клиент набирает, и вторая копия правила
 * разошлась бы с ядром молча — на экране одно число, в заявке другое.
 *
 * Ставка берётся со всей суммы, а не с превышения над порогом. Отсюда
 * обрывы на границах: отдавший 500,01 доллара получает заметно меньше
 * отдавшего ровно 500. Это решение владельца при названной цене
 * (`.scratch/exchange-pricing/spec.md`), а не недосмотр, и закреплено
 * тестом — «починка» ломает договорённость, а не ошибку.
 */

/**
 * Ступень: до какой суммы она действует и сколько стоит.
 *
 * `upToUsd` — верхняя граница включительно; `null` у последней ступени
 * означает «и всё, что выше». Ставка ровно одного вида: либо
 * фиксированная сумма в долларах, либо доля в базисных пунктах. Двух
 * сразу не бывает — сумма и процент в одной строке означали бы, что
 * никто не знает, сколько стоит обмен.
 */
export const feeTierSchema = z
  .object({
    upToUsd: Money.amountSchema.nullable(),
    fixedUsd: Money.amountSchema.optional(),
    rateBps: z.number().int().min(0).max(10_000).optional(),
  })
  .refine(
    (tier) => (tier.fixedUsd === undefined) !== (tier.rateBps === undefined),
    'У ступени должна быть ровно одна ставка: сумма или доля',
  );

export type FeeTier = z.infer<typeof feeTierSchema>;

/**
 * Сетка целиком: ступени по возрастанию порога, последняя без границы.
 *
 * Проверяется здесь, а не только в базе, потому что по этой же сетке
 * считает экран: приехавшая с сервера сетка с дырой между ступенями
 * дала бы клиенту выдачу, которой не будет.
 */
export const feeScheduleSchema = z
  .array(feeTierSchema)
  .min(1)
  .refine((tiers) => tiers[tiers.length - 1]?.upToUsd === null, {
    message: 'Последняя ступень действует без верхней границы',
  })
  .refine(
    (tiers) =>
      tiers.slice(0, -1).every((tier, index) => {
        const previous = index === 0 ? null : tiers[index - 1]?.upToUsd;
        return (
          tier.upToUsd !== null &&
          (previous === null ||
            previous === undefined ||
            Money.compare(tier.upToUsd, previous) > 0)
        );
      }),
    { message: 'Пороги ступеней должны возрастать' },
  );

export type FeeSchedule = z.infer<typeof feeScheduleSchema>;

/**
 * Ступень, под которую попадает сумма. Порог включительный: ровно
 * пятьсот долларов — это ещё нижняя ступень, а 500,01 уже следующая.
 */
function tierFor(usdAmount: Amount, schedule: readonly FeeTier[]): FeeTier | undefined {
  return schedule.find(
    (tier) => tier.upToUsd === null || Money.compare(usdAmount, tier.upToUsd) <= 0,
  );
}

/**
 * Сколько сервис берёт с этой суммы. Считается в долларах — той валюте,
 * в которой заданы и пороги, и фиксированная ставка.
 */
export function feeFor(usdAmount: Amount, schedule: readonly FeeTier[]): Amount {
  const tier = tierFor(usdAmount, schedule);
  if (!tier) return Money.ZERO;
  if (tier.fixedUsd !== undefined) return tier.fixedUsd;
  return Money.percentOf(usdAmount, tier.rateBps ?? 0);
}

/**
 * Что остаётся от суммы после комиссии — то, что и переводится в валюту
 * выдачи.
 *
 * Ниже нуля не опускается: фиксированная ставка больше самой суммы
 * означает заявку, которую отсекает минимальный порог, а отрицательный
 * остаток ядро приняло бы за испорченный курс и промолчало бы вместо
 * внятного отказа.
 */
export function netAfterFee(usdAmount: Amount, schedule: readonly FeeTier[]): Amount {
  const net = Money.subtract(usdAmount, feeFor(usdAmount, schedule));
  return Money.isNegative(net) ? Money.ZERO : net;
}
