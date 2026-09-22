'use client';

import { CurrencyFlag } from '@nemo/flags';
import { Money, readRate, type Amount, type Quote } from '@nemo/types';
import { formatAmount, formatMoney } from '@nemo/ui/format';
import { examplePay, posRateLine, posSides, type PosSide } from '@/lib/pos';
import { markupPercent } from '@/lib/pos/settings';

/**
 * Путь денег покупателя на живых числах — тот же приём, что у табло
 * курсов (`rates/explainer.tsx`): показ вместо рассказа.
 *
 * Три шага: платит → по курсу → получает, и все три посчитаны той же
 * арифметикой, какой посчитает счёт (`posSides` и `posRateLine` поверх
 * `@nemo/types`, с наценкой мерчанта). Пока своя сумма не набрана,
 * берётся круглый пример в рублях, и подпись так его и зовёт;
 * набранная выигрывает — объяснение идёт на тех числах, которые
 * сейчас стоят в терминале.
 *
 * Наценка названа шагом, а не спрятана в курсе: сотрудник у стойки
 * должен понимать, из чего сложилось число, которое он называет вслух.
 * 22 сентября 2026 владелец попросил «как это устроено — сделать как
 * на странице „Курсы“, более понятно и интерактивно».
 */
export function PosPath({
  fromCode,
  toCode,
  quote,
  typed,
  side,
  markupBps,
  minAmount,
  payDecimals,
}: {
  readonly fromCode: string;
  readonly toCode: string;
  /** Котировка направления; `null` — источник молчит, `undefined` — ещё спрашиваем. */
  readonly quote: Quote | null | undefined;
  /** Что набрано в терминале и в какой стороне. */
  readonly typed: Amount | null;
  readonly side: PosSide;
  readonly markupBps: number;
  readonly minAmount: Amount;
  /** До какого знака ровняется сумма к оплате в этой валюте. */
  readonly payDecimals: number;
}) {
  const own = typed !== null && !Money.isZero(typed);
  const sides = own
    ? posSides(typed, side, quote ?? null, markupBps, payDecimals)
    : posSides(examplePay(), 'pay', quote ?? null, markupBps, payDecimals);
  const line = quote
    ? posRateLine(quote, sides.pay, minAmount, markupBps, payDecimals)
    : ({ kind: 'none' } as const);
  const reading = line.kind === 'rate' ? readRate(line.rate, fromCode, toCode) : null;

  return (
    <div className="money-path">
      <p className="money-path__lead">
        <span className="money-path__pair">
          <CurrencyFlag code={fromCode} size={16} />
          <CurrencyFlag code={toCode} size={16} />
          <b>
            {fromCode} → {toCode}
          </b>
        </span>
        <span className="muted">
          {own ? 'на вашей сумме' : 'на примере'} · выберите другую валюту, чтобы сменить
        </span>
      </p>

      <div className="money-path__steps">
        <div className="money-path__step">
          <span className="label">Покупатель платит</span>
          <span
            className={sides.pay ? 'money-path__value' : 'money-path__value path__value--quiet'}
          >
            {sides.pay ? formatMoney(sides.pay, fromCode) : '—'}
          </span>
          <span className="money-path__note">
            {own
              ? payDecimals === 0
                ? 'ваша сумма, вверх до целой единицы'
                : 'ваша сумма, вверх на знаке валюты'
              : 'для примера; наберите свою ниже'}
          </span>
        </div>

        <span className="money-path__arrow" aria-hidden>
          →
        </span>

        <div className="money-path__step">
          <span className="label">По курсу</span>
          {reading ? (
            <>
              <span className="money-path__value">{formatAmount(reading.value)}</span>
              <span className="money-path__note">
                {reading.perCode} за 1 {reading.unitCode}
                {markupBps > 0
                  ? `: курс сервиса и ваша наценка ${markupPercent(markupBps)} %`
                  : ': курс сервиса, тот же, что в «Курсах»'}
              </span>
            </>
          ) : line.kind === 'from' ? (
            <>
              <span className="money-path__value">
                от {formatMoney(line.giveAtLeast, fromCode)}
              </span>
              <span className="money-path__note">на меньшую сумму счёт не создать</span>
            </>
          ) : quote === null ? (
            <>
              <span className="money-path__value path__value--quiet">курса нет</span>
              <span className="money-path__note">источник котировки молчит; счёт не создать</span>
            </>
          ) : (
            <>
              <span className="money-path__value path__value--quiet">спрашиваем…</span>
              <span className="money-path__note">курс приходит с биржи, это секунды</span>
            </>
          )}
        </div>

        <span className="money-path__arrow" aria-hidden>
          →
        </span>

        <div className="money-path__step">
          <span className="label">Получает</span>
          <span
            className={sides.buy ? 'money-path__value' : 'money-path__value path__value--quiet'}
          >
            {sides.buy ? formatMoney(sides.buy, toCode) : '—'}
          </span>
          <span className="money-path__note">
            {sides.buy ? 'столько вы выдаёте покупателю' : 'считать пока нечего'}
          </span>
        </div>
      </div>

      <p className="money-path__fresh">
        Курс живой и перечитывается каждые полминуты. В счёт запишется тот, что стоит на экране в
        момент «Создать счёт», и по нему же счёт считается потом.
      </p>
    </div>
  );
}
