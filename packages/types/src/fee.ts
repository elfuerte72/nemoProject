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
 * означает «и всё, что выше». Ставка — доля в базисных пунктах, фикс в
 * долларах или фикс в валюте выдачи; доля сочетается с любым фиксом
 * (формула владельца для евро: «3,3 % и 10 EUR сверху»). Два фикса
 * разом — нельзя: один вычитается до умножения на курс, второй после,
 * и вместе они означали бы, что никто не знает, сколько стоит обмен.
 */
export const feeTierSchema = z
  .object({
    /*
     * Порог строго больше нуля, а ставка не отрицательна — те же
     * пределы, что держит база (`fee_schedule_tiers_threshold_positive`
     * и соседи). Записаны и здесь, потому что сюда приходит набранное
     * руками: без них ноль в поле «до» доезжал бы до `insert` и
     * возвращался администратору внутренней ошибкой вместо объяснения.
     */
    upToUsd: Money.amountSchema
      .nullable()
      .refine(
        (value) => value === null || (!Money.isZero(value) && !Money.isNegative(value)),
        'Порог ступени должен быть больше нуля',
      ),
    fixedUsd: Money.amountSchema
      .refine((value) => !Money.isNegative(value), 'Ставка не может быть отрицательной')
      .optional(),
    rateBps: z.number().int().min(0).max(10_000).optional(),
    /**
     * Фиксированная часть в валюте выдачи: десять евро остаются десятью
     * при любом курсе, долларом их не задать. Вычитается после перевода
     * остатка по курсу — в отличие от `fixedUsd`, который уходит до.
     */
    fixedPayout: Money.amountSchema
      .refine((value) => !Money.isNegative(value), 'Ставка не может быть отрицательной')
      .optional(),
  })
  .refine(
    (tier) =>
      tier.fixedUsd !== undefined || tier.rateBps !== undefined || tier.fixedPayout !== undefined,
    'У ступени должна быть хотя бы одна ставка: доля или фиксированная сумма',
  )
  .refine(
    (tier) => tier.fixedUsd === undefined || tier.fixedPayout === undefined,
    'Фикс на ступени один: в долларах или в валюте выдачи, но не оба разом',
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
 * Долларовая часть комиссии: доля от всей суммы плюс долларовый фикс.
 * Фикс в валюте выдачи сюда не входит — он вычитается после перевода по
 * курсу, и в долларах его не выразить (`payoutAfterFee`).
 */
export function feeFor(usdAmount: Amount, schedule: readonly FeeTier[]): Amount {
  const tier = tierFor(usdAmount, schedule);
  if (!tier) return Money.ZERO;
  return Money.add(tier.fixedUsd ?? Money.ZERO, Money.percentOf(usdAmount, tier.rateBps ?? 0));
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
 * Выдача целиком: долларовый остаток переводится по курсу, и уже из
 * него вычитается фикс в валюте выдачи.
 *
 * `fromBaseRate` — сколько валюты выдачи дают за один доллар. Считать
 * по-прежнему «остаток на курс» снаружи нельзя: фикс в валюте выдачи
 * потерялся бы молча, и экран пообещал бы больше, чем запишет ядро.
 *
 * Ниже нуля не опускается — по той же причине, что и `netAfterFee`.
 */
export function payoutAfterFee(
  usdAmount: Amount,
  fromBaseRate: Amount,
  schedule: readonly FeeTier[],
): Amount {
  const gross = Money.multiply(netAfterFee(usdAmount, schedule), fromBaseRate);
  const fixed = tierFor(usdAmount, schedule)?.fixedPayout ?? Money.ZERO;
  const payout = Money.subtract(gross, fixed);
  return Money.isNegative(payout) ? Money.ZERO : payout;
}

/**
 * До скольких знаков округляется найденная сумма. Столько же показывает
 * экран: число, обрезанное при показе, перестало бы давать обещанное.
 */
const REVERSE_SCALE = 8;

/**
 * Обратный счёт: сколько долларов отдать, чтобы после комиссии в валюте
 * выдачи вышло не меньше названного.
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
 *
 * Цель названа в валюте выдачи, а не в долларах: фикс ступени может
 * быть задан этой валютой, и перевод цели в доллары зависит от того, на
 * какую ступень попадёт ответ, — деление на курс живёт внутри перебора,
 * а не до него.
 */
export function usdForPayout(
  target: Amount,
  fromBaseRate: Amount,
  schedule: readonly FeeTier[],
): Amount | null {
  if (Money.isZero(target) || Money.isNegative(target)) return null;
  // Нулевым курсом не делят, отрицательный — испорченные данные: сумму
  // отдачи по ним не выдумать.
  if (Money.isZero(fromBaseRate) || Money.isNegative(fromBaseRate)) return null;

  const candidates: Amount[] = [];

  for (const [index, tier] of schedule.entries()) {
    const floorUsd = index === 0 ? null : (schedule[index - 1]?.upToUsd ?? null);

    /*
     * Решение уравнения этой ступени:
     * `usd = ((цель + фикс валюты) / курс + фикс долларов) / (1 − доля)`.
     * Каждое деление — вверх: делить вниз значило бы обещать сумму,
     * которой не выйдет.
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
    if (Money.isZero(share)) continue;

    const grossUsd = Money.divideCeil(
      Money.add(target, tier.fixedPayout ?? Money.ZERO),
      fromBaseRate,
      REVERSE_SCALE,
    );
    const solved = Money.divideCeil(
      Money.add(grossUsd, tier.fixedUsd ?? Money.ZERO),
      share,
      REVERSE_SCALE,
    );

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
    if (
      withinTop &&
      Money.compare(payoutAfterFee(shifted, fromBaseRate, schedule), target) >= 0
    ) {
      candidates.push(shifted);
    }

    // И сама граница: за ней ставка меняется, и сумма, недостижимая
    // внутри ступени, оказывается достижимой ровно на её краю.
    if (
      tier.upToUsd !== null &&
      Money.compare(payoutAfterFee(tier.upToUsd, fromBaseRate, schedule), target) >= 0
    ) {
      candidates.push(tier.upToUsd);
    }
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((least, one) => (Money.compare(one, least) < 0 ? one : least));
}

/**
 * Тот же обратный счёт, но с целью в долларах — для сеток, где фикса в
 * валюте выдачи нет. Частный случай `usdForPayout` с курсом-единицей:
 * два перебора разошлись бы на первом же исправлении.
 */
export function usdForNet(target: Amount, schedule: readonly FeeTier[]): Amount | null {
  return usdForPayout(target, Money.toAmount('1'), schedule);
}
