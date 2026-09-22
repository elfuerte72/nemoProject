'use client';

import { CurrencyFlag } from '@nemo/flags';
import { readRate, type Amount } from '@nemo/types';
import { formatAmount, formatMoney } from '@nemo/ui/format';
import type { DirectionRate } from '@/lib/direction-rates';
import { exampleGive, priceOn, quoteAge } from '@/lib/rate-board';

/**
 * Путь денег на живых числах — показ вместо рассказа.
 *
 * Три шага: отдаёте → по курсу → получаете, и все три посчитаны той же
 * арифметикой, какой посчитает заявка (`priceOn` поверх `rateLine` и
 * `payoutOf`). Пока своя сумма не набрана, берётся круглый пример в
 * валюте отдачи, и подпись так его и зовёт; набранная выигрывает.
 *
 * Направление — то, которое мерчант выбрал в таблице нажатием, а до
 * выбора первое видимое: объяснять устройство удобнее на строке, за
 * которой человек и пришёл.
 *
 * Полосы «курс держится N из 120 минут» здесь нет намеренно: срок
 * оплаты идёт с выдачи реквизитов, то есть уже после подачи, а на
 * табло курс живой и ничем не зафиксирован. Вместо неё — честная строка
 * о свежести котировки.
 */
export function PathOfMoney({
  direction,
  typed,
  minAmount,
  now,
}: {
  readonly direction: DirectionRate | undefined;
  /** Своя сумма мерчанта, если набрана над таблицей. */
  readonly typed: Amount | null;
  readonly minAmount: Amount;
  readonly now: Date;
}) {
  if (!direction) {
    return <p className="money-path__empty">Выберите направление в таблице — разберём его здесь.</p>;
  }

  const give = exampleGive(direction.fromCode, typed);
  const own = typed !== null && give === typed;
  const { line, payout } = priceOn(direction, give, minAmount);
  const reading =
    line.kind === 'rate' ? readRate(line.rate, direction.fromCode, direction.toCode) : null;
  const age = quoteAge(direction.quotedAt, now);
  /*
   * Со ступенчатой сеткой курс зависит от суммы, и на примере он не
   * совпадёт с тем, что стоит в строке таблицы: там курс для наименьшей
   * суммы направления, где фикс комиссии съедает заметную долю. Рядом
   * без слов это читается как противоречие — поэтому слова стоят ровно
   * тут. Со своей суммой расхождения нет: строка пересчитана на неё же.
   */
  const differsFromRow = !own && direction.quote?.fee !== undefined;

  return (
    <div className="money-path">
      <p className="money-path__lead">
        <span className="money-path__pair">
          <CurrencyFlag code={direction.fromCode} size={16} />
          <CurrencyFlag code={direction.toCode} size={16} />
          <b>
            {direction.fromCode} → {direction.toCode}
          </b>
        </span>
        <span className="muted">
          {own ? 'на вашей сумме' : 'на примере'} · нажмите другую строку, чтобы сменить
        </span>
      </p>

      <div className="money-path__steps">
        <div className="money-path__step">
          <span className="label">Отдаёте</span>
          <span className="money-path__value">{formatMoney(give, direction.fromCode)}</span>
          <span className="money-path__note">
            {own ? 'сумма, которую вы набрали' : 'для примера; наберите свою над таблицей'}
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
                {differsFromRow
                  ? ' на этой сумме; в строке таблицы — для наименьшей'
                  : ', наценка уже внутри'}
              </span>
            </>
          ) : line.kind === 'from' ? (
            <>
              <span className="money-path__value">от {formatMoney(line.giveAtLeast, direction.fromCode)}</span>
              <span className="money-path__note">на эту сумму направление не работает</span>
            </>
          ) : (
            <>
              <span className="money-path__value path__value--quiet">назовёт менеджер</span>
              <span className="money-path__note">источник котировки молчит</span>
            </>
          )}
        </div>

        <span className="money-path__arrow" aria-hidden>
          →
        </span>

        <div className="money-path__step">
          <span className="label">Получаете</span>
          <span className={payout ? 'money-path__value' : 'money-path__value path__value--quiet'}>
            {payout ? formatMoney(payout, direction.toCode) : '—'}
          </span>
          <span className="money-path__note">
            {payout
              ? direction.quote?.fee
                ? 'комиссия направления уже вычтена'
                : 'ровно по курсу, без доплат'
              : 'считать пока нечего'}
          </span>
        </div>
      </div>

      {age ? (
        <p className="money-path__fresh" suppressHydrationWarning>
          Котировка снята {age}. Обновляется сама, пока страница открыта; курс замрёт только в
          момент подачи заявки.
        </p>
      ) : undefined}
    </div>
  );
}
