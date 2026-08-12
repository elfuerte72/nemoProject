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

/**
 * До скольких знаков округляется найденная сумма. Столько же показывает
 * экран: число, обрезанное при показе, перестало бы давать обещанное.
 */
const REVERSE_SCALE = 8;

/**
 * Обратный счёт: сколько отдать, чтобы после комиссии осталось не меньше
 * названного.
 *
 * Вопрос звучит не реже прямого — с ним приходят за суммой брони, счёта
 * или билета. Со ступенями он перестаёт быть делением: ставка берётся от
 * всей суммы, и выдача на границах скачет. Часть сумм получения
 * достижима двумя разными суммами отдачи, часть — ни одной.
 *
 * Поэтому решается перебором: на каждой ступени уравнение решается своё,
 * решение отбрасывается, если выпало за её границы, и из уцелевших
 * берётся наименьшее. Ступеней единицы, и перебор стоит ничего.
 *
 * К решениям добавляются сами границы: сумма, недостижимая внутри
 * ступени, часто достижима ровно на её краю — там ставка ещё старая, а
 * сумма уже больше.
 *
 * Округление вверх, а не вниз: отброшенный хвост возвращается вычетом
 * комиссии как недостача, и клиент, просивший пятьдесят тысяч, получил
 * бы 49 999.
 */
export function usdForNet(target: Amount, schedule: readonly FeeTier[]): Amount | null {
  if (Money.isZero(target) || Money.isNegative(target)) return null;

  const candidates: Amount[] = [];

  for (const [index, tier] of schedule.entries()) {
    const floorUsd = index === 0 ? null : (schedule[index - 1]?.upToUsd ?? null);

    /*
     * Решение уравнения этой ступени. С фиксированной ставкой оно
     * прямое, с долей — деление вверх: делить вниз значило бы обещать
     * сумму, которой не выйдет.
     */
    const share = Money.subtract(
      Money.toAmount('1'),
      Money.percentOf(Money.toAmount('1'), tier.rateBps ?? 0),
    );
    /*
     * Ставка во всю сумму оставляет клиенту ноль, сколько бы он ни
     * отдал: уравнение этой ступени решений не имеет. Пропускается
     * молча — иначе деление на ноль роняло бы экран вместо честного
     * «такой суммы не выйдет». Ограничение базы такую ставку
     * пропускает: сто процентов — опечатка, а не невозможное значение.
     */
    if (tier.fixedUsd === undefined && Money.isZero(share)) continue;

    const solved =
      tier.fixedUsd !== undefined
        ? Money.add(target, tier.fixedUsd)
        : Money.divideCeil(target, share, REVERSE_SCALE);

    /*
     * Решение засчитывается, только если попало в свою ступень: иначе
     * ставка при такой сумме будет другой, и равенство развалится.
     *
     * Выпавшее на нижнюю границу — особый случай: сама граница
     * принадлежит предыдущей ступени, где ставка выше, и решение там
     * неверно. Но верный ответ лежит на волосок выше — первой суммой,
     * которая уже считается по этой ставке.
     */
    const step = Money.toAmount(`0.${'0'.repeat(REVERSE_SCALE - 1)}1`);
    const shifted =
      floorUsd !== null && Money.compare(solved, floorUsd) <= 0
        ? Money.add(floorUsd, step)
        : solved;
    const withinTop = tier.upToUsd === null || Money.compare(shifted, tier.upToUsd) <= 0;
    if (withinTop && Money.compare(netAfterFee(shifted, schedule), target) >= 0) {
      candidates.push(shifted);
    }

    // И сама граница: за ней ставка меняется, и сумма, недостижимая
    // внутри ступени, оказывается достижимой ровно на её краю.
    if (tier.upToUsd !== null && Money.compare(netAfterFee(tier.upToUsd, schedule), target) >= 0) {
      candidates.push(tier.upToUsd);
    }
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((least, one) => (Money.compare(one, least) < 0 ? one : least));
}
