import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { EmptyState, firstParam, HowTo, Moment, PeriodChips } from '@nemo/ui';
import {
  PERIOD_LABELS,
  TZ_COOKIE,
  dayOf,
  readTzOffset,
  resolvePeriod,
  type PeriodKey,
} from '@nemo/ui/period';
import { currencyName } from '@nemo/types';
import { AMBASSADOR_SERVICES_HOW_TO } from '@/lib/ambassador-texts';
import { ambassadorPage } from '@/lib/ambassador-reads';
import { getCore } from '@/lib/core';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Услуги — кабинет амбассадора' };

const QUICK: readonly PeriodKey[] = ['15d', '30d', '45d', '90d', '180d'];

/**
 * Чем пользовались приведённые — ответ на вопрос «какие услуги
 * выбирали».
 *
 * Направления по числу исполненных заявок и по числу людей: десять
 * заявок одного человека и по одной от десятерых — разные вещи, и
 * столбец с людьми отличает первое от второго. Денег здесь нет: валюты
 * не складываются, а десять столбцов в разных валютах не читаются.
 */
export default async function AmbassadorServices({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await ambassadorPage();
  const params = await searchParams;
  const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
  const period = resolvePeriod(
    {
      period: firstParam(params.period) ?? '30d',
      from: firstParam(params.from),
      to: firstParam(params.to),
    },
    new Date(),
    offset,
  );

  const services = await getCore().listReferralServices(actor, {
    from: period.from,
    to: period.to,
  });
  const lastDay = new Date(period.to.getTime() - 1);
  const total = services.reduce((sum, one) => sum + one.count, 0);

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Услуги</h1>
          <p className="page__sub">
            {PERIOD_LABELS[period.key]}: <Moment at={period.from.toISOString()} mode="day" /> —{' '}
            <Moment at={lastDay.toISOString()} mode="day" />
          </p>
        </div>
      </header>

      <HowTo
        title="Что здесь показано"
        sub="Направления обмена, а не деньги"
        items={AMBASSADOR_SERVICES_HOW_TO}
      />

      <PeriodChips
        current={period.key}
        basePath="/ambassador/services"
        quick={QUICK}
        from={dayOf(period.from, offset)}
        to={dayOf(lastDay, offset)}
      />

      {services.length ? (
        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Направления</h2>
              <p className="card__note">{total} исполненных заявок за период</p>
            </div>
          </div>
          <div className="scroll-x">
            <table className="datatable">
              <thead>
                <tr>
                  <th>Направление</th>
                  <th className="num">Заявок</th>
                  <th className="num">Человек</th>
                </tr>
              </thead>
              <tbody>
                {services.map((row) => (
                  <tr key={`${row.fromCode}-${row.toCode}`}>
                    <td>
                      <div className="cell">
                        <span>
                          {row.fromCode} → {row.toCode}
                        </span>
                        <span className="cell__note">
                          {currencyName(row.fromCode)} в {currencyName(row.toCode)}
                        </span>
                      </div>
                    </td>
                    <td className="num">{row.count}</td>
                    <td className="num">{row.clients}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyState
          icon="exchange"
          title="За период обменов не было"
          text="Считаются исполненные заявки ваших людей. Возьмите период подлиннее — до полугода."
        />
      )}
    </main>
  );
}
