import Link from 'next/link';
import { arrangeRateBoard, currencyName, currencyPlace, payoutPerUnit, type Amount } from '@nemo/types';
import { HowTo, QuietRefresh, Stat, Stats } from '@nemo/ui';
import { formatAmount, formatMoney, formatRate, formatRateValue } from '@nemo/ui/format';
import { getCore } from '@/lib/core';
import { listDirectionRates } from '@/lib/direction-rates';
import { RATES_HOW_TO } from '@/lib/exchange-texts';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';

export const dynamic = 'force-dynamic';

/**
 * Раздел «Курсы»: весь справочник безналичных направлений живым курсом
 * — то же, что бот показывает клиенту по кнопке «Курс», и той же
 * раскладкой (`arrangeRateBoard` из `@nemo/types`): рубль двумя
 * строками, потому что котировок у него две; валюты выдачи столбцом с
 * одной стороной на все строки — перевёрнутый курс отвечал бы на
 * обратный вопрос, а заметить это среди одинаковых строк невозможно;
 * прочие направления — своими строками. Курс — для наименьшей суммы
 * направления; точную цену на свою сумму даёт форма новой заявки.
 *
 * Отметки времени над курсом нет: биржевая котировка живёт минуту,
 * опорный курс банка сутками, и одна отметка врала бы про половину
 * строк. Экран перечитывает себя по таймеру, как остальные.
 */

/** Число в столбце валют выдачи — одним правилом с сообщением бота; здесь только разряды. */
function payoutValue(rate: Amount): string {
  return formatAmount(payoutPerUnit(rate));
}

export default async function RatesPage() {
  const { session } = await viewer();
  const { directions, terms } = await listDirectionRates(getCore());

  const { sell, buy, payout, rest } = arrangeRateBoard(directions);

  return (
    <main className="page">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Курсы</h1>
          <p className="page__sub">
            Курс с учётом наценки: по нему и обменяем. Обновляется раз в минуту.
          </p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--gold" href="/requests/new">
            Новая заявка
          </Link>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Что за число и как долго оно держится" items={RATES_HOW_TO} />

      <Stats>
        <Stat
          label="Минимальная сумма"
          value={formatMoney(terms.minAmount, terms.minAmountCode)}
          note="считается по стороне заявки в USDT"
        />
        <Stat
          label="Срок оплаты"
          value={`${terms.unpaidTtlMinutes} мин`}
          note="с выдачи реквизитов; столько держится курс"
        />
        <Stat label="Направлений" value={directions.length} note="безналичных, из кабинета и по API" />
      </Stats>

      {directions.length === 0 ? (
        <section className="card">
          <p className="muted">Направления обмена ещё не заведены. Загляните позже.</p>
        </section>
      ) : undefined}

      {sell || buy ? (
        <section className="card">
          <h2 className="card__title">USDT и рубль</h2>
          <dl className="summary">
            {sell ? (
              <div className="summary__row">
                <dt>Продаёте USDT</dt>
                <dd className="summary__strong">
                  {sell.rate ? `по ${formatRateValue(sell.rate)} ₽` : 'курс назовёт менеджер'}
                </dd>
              </div>
            ) : undefined}
            {buy ? (
              <div className="summary__row">
                <dt>Покупаете USDT</dt>
                <dd className="summary__strong">
                  {buy.rate ? `по ${formatRateValue(buy.rate)} ₽` : 'курс назовёт менеджер'}
                </dd>
              </div>
            ) : undefined}
          </dl>
        </section>
      ) : undefined}

      {payout.length > 0 ? (
        <section className="card">
          <h2 className="card__title">Выдаём за 1 USDT</h2>
          <ul className="table table--rates">
            <li className="table__head" aria-hidden>
              <span>Валюта</span>
              <span>Где ходит</span>
              <span>За 1 USDT</span>
              <span>Минимум направления</span>
            </li>
            {payout.map((one) => (
              <li key={`${one.fromCode}-${one.toCode}`} className="table__item">
                <span className="table__row">
                  <span className="cell">
                    <span className="cell__label">Валюта</span>
                    <span className="cell__value">
                      {one.toCode}
                      <span className="muted"> · {currencyName(one.toCode)}</span>
                    </span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Где ходит</span>
                    <span className="cell__value">{currencyPlace(one.toCode) || '—'}</span>
                  </span>
                  <span className="cell cell--num">
                    <span className="cell__label">За 1 USDT</span>
                    <span className="cell__value">
                      {one.rate ? `${payoutValue(one.rate)} ${one.toCode}` : 'назовёт менеджер'}
                    </span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Минимум направления</span>
                    <span className="cell__value">
                      {one.minAmountUsd ? formatMoney(one.minAmountUsd, '$') : '—'}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : undefined}

      {rest.length > 0 ? (
        <section className="card">
          <h2 className="card__title">Другие направления</h2>
          <ul className="table table--rates">
            <li className="table__head" aria-hidden>
              <span>Отдаёте</span>
              <span>Получаете</span>
              <span>Курс</span>
              <span>Минимум направления</span>
            </li>
            {rest.map((one) => (
              <li key={`${one.fromCode}-${one.toCode}`} className="table__item">
                <span className="table__row">
                  <span className="cell">
                    <span className="cell__label">Отдаёте</span>
                    <span className="cell__value">{one.fromCode}</span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Получаете</span>
                    <span className="cell__value">
                      {one.toCode}
                      <span className="muted"> · {currencyName(one.toCode)}</span>
                    </span>
                  </span>
                  <span className="cell cell--num">
                    <span className="cell__label">Курс</span>
                    <span className="cell__value">
                      {one.rate ? formatRate(one.rate, one.fromCode, one.toCode) : 'назовёт менеджер'}
                    </span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Минимум направления</span>
                    <span className="cell__value">
                      {one.minAmountUsd ? formatMoney(one.minAmountUsd, '$') : '—'}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : undefined}
    </main>
  );
}
