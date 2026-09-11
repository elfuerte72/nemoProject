import { cookies } from 'next/headers';
import Link from 'next/link';
import {
  EmptyState,
  ExchangeCountTiles,
  firstParam,
  formatMinutes,
  formatShare,
  Funnel,
  HowTo,
  Moment,
  MoneyCompare,
  PeriodChips,
  QuietRefresh,
  Stat,
  Stats,
  trendTone,
} from '@nemo/ui';
import { formatMoney } from '@nemo/ui/format';
import { averageByCurrency, formatByCurrency } from '@nemo/ui/money-list';
import { PERIOD_LABELS, TZ_COOKIE, dayOf, readTzOffset, resolvePeriod } from '@nemo/ui/period';
import { ANALYTICS_HOW_TO, STEP_KEYS, STEP_LABELS, resolveStep } from '@/lib/analytics-texts';
import { analyticsTables } from '@/lib/analytics-rows';
import { STATUS_LABELS } from '@/lib/labels';
import { merchantBreakdowns, merchantStats, viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { Dynamics } from './dynamics';

export const dynamic = 'force-dynamic';

/**
 * Аналитика мерчанта: то же, что на обзоре, но по чему именно.
 *
 * Отдельного пункта меню у раздела нет — входят в него с обзора: ещё
 * одна строка в меню обещала бы вторую правду о тех же числах. Период и
 * шаг сетки живут в адресе: считает их сервер, а ссылку на «прошлые
 * тридцать дней по неделям» можно переслать.
 *
 * Числа — по правилам ADR-0013 и той же операцией, что у панели:
 * заявки по дате подачи, деньги по дате исполнения, валюты не
 * складываются никогда.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session } = await viewer();
  const params = await searchParams;
  const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
  const period = resolvePeriod(
    {
      period: firstParam(params.period),
      from: firstParam(params.from),
      to: firstParam(params.to),
    },
    new Date(),
    offset,
  );
  const step = resolveStep(firstParam(params.step));

  const [stats, cut] = await Promise.all([
    merchantStats(period.from.getTime(), period.to.getTime(), offset),
    merchantBreakdowns(period.from.getTime(), period.to.getTime(), offset, step),
  ]);
  const { current, previous } = stats;
  const lastDay = new Date(period.to.getTime() - 1);
  const query = new URLSearchParams({
    period: period.key,
    from: dayOf(period.from, offset),
    to: dayOf(lastDay, offset),
  });
  const tables = analyticsTables(cut);
  // Валюты переключателя — те, в которых оборот был: строка «Оборот,
  // THB» без единой сделки в батах обещала бы разрез, за которым пусто.
  const currencies = [...new Set(cut.series.flatMap((one) => one.turnover.map((line) => line.code)))]
    .sort((a, b) => a.localeCompare(b));
  const clock = offset === 0 ? 'по UTC' : 'по вашим часам';
  const anything = current.submitted > 0 || current.completed > 0;

  return (
    <main className="page page--wide">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Аналитика</h1>
          <p className="page__sub">
            {PERIOD_LABELS[period.key]}: <Moment at={period.from.toISOString()} mode="day" /> —{' '}
            <Moment at={lastDay.toISOString()} mode="day" />
            {offset === 0 ? ' · дни и часы считаются по UTC' : ''}
          </p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--soft btn--tiny" href="/dashboard">
            К обзору
          </Link>
        </div>
      </header>

      <HowTo title="Как читать аналитику" sub="Откуда числа и с чем они сравниваются" items={ANALYTICS_HOW_TO} />

      <PeriodChips
        current={period.key}
        basePath="/analytics"
        from={dayOf(period.from, offset)}
        to={dayOf(lastDay, offset)}
      />

      <Stats>
        <ExchangeCountTiles current={current} previous={previous} openHref="/requests" />
        <Stat
          label="Конверсия"
          value={formatShare(current.conversion)}
          note={
            current.conversion === null
              ? 'поданных в период нет'
              : `исполнено из поданных · было ${formatShare(previous.conversion)}`
          }
          tone={trendTone(current.conversion, previous.conversion)}
        />
      </Stats>

      {anything ? undefined : (
        <EmptyState
          icon="chart"
          title="За этот период заявок нет"
          text="Разрезы появятся, как только в период попадёт хотя бы одна заявка. Возьмите период шире или подайте первую."
        />
      )}

      <div className="grid">
        <section className="card">
          <h2 className="card__title">Оборот</h2>
          <p className="card__note">Отдано по исполненным заявкам — по каждой валюте отдельно</p>
          <MoneyCompare now={current.turnover} before={previous.turnover} />
        </section>

        <section className="card">
          <h2 className="card__title">Средний чек</h2>
          <p className="card__note">Оборот на число исполненных заявок — по каждой валюте</p>
          <p className="money">{formatByCurrency(averageByCurrency(current.turnover))}</p>
          <p className="muted">было {formatByCurrency(averageByCurrency(previous.turnover))}</p>
        </section>

        <section className="card">
          <h2 className="card__title">Рекорды периода</h2>
          <p className="card__note">Что выбивалось из ряда, {clock}</p>
          <ul className="rows rows--tight">
            {cut.records.largest.length === 0 ? (
              <li className="muted">Исполненных заявок в период нет</li>
            ) : (
              cut.records.largest.map((one) => (
                <li key={one.code} className="row">
                  <div className="row__main">
                    <span className="row__title">
                      <Link href={`/requests/${one.requestId}`}>
                        {formatMoney(one.amount, one.code)}
                      </Link>
                    </span>
                    <span className="row__meta">
                      крупнейшая в {one.code}
                      {one.reference ? ` · ${one.reference}` : ''}
                    </span>
                  </div>
                </li>
              ))
            )}
            {cut.records.fastest ? (
              <li className="row">
                <div className="row__main">
                  <span className="row__title">
                    <Link href={`/requests/${cut.records.fastest.requestId}`}>
                      {formatMinutes(cut.records.fastest.minutes)}
                    </Link>
                  </span>
                  <span className="row__meta">быстрее всех, от подачи до исполнения</span>
                </div>
              </li>
            ) : undefined}
            {cut.records.slowest ? (
              <li className="row">
                <div className="row__main">
                  <span className="row__title">
                    <Link href={`/requests/${cut.records.slowest.requestId}`}>
                      {formatMinutes(cut.records.slowest.minutes)}
                    </Link>
                  </span>
                  <span className="row__meta">дольше всех</span>
                </div>
              </li>
            ) : undefined}
            {cut.records.busiestDay ? (
              <li className="row">
                <div className="row__main">
                  <span className="row__title">{cut.records.busiestDay.day}</span>
                  <span className="row__meta">
                    самый плотный шаг: подано {cut.records.busiestDay.submitted}
                  </span>
                </div>
              </li>
            ) : undefined}
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Динамика</h2>
            <p className="card__note">
              Подано и отменено по своим датам, оборот — по исполнению, {clock}
            </p>
          </div>
          <div className="chips">
            {STEP_KEYS.map((key) => (
              <Link
                key={key}
                href={`/analytics?${new URLSearchParams({ ...Object.fromEntries(query), step: key }).toString()}`}
                className={key === step ? 'chip chip--on' : 'chip'}
                scroll={false}
              >
                {STEP_LABELS[key]}
              </Link>
            ))}
          </div>
        </div>
        <Dynamics points={toPoints(cut.series)} currencies={currencies} />
      </section>

      <section className="card">
        <h2 className="card__title">Воронка заявок</h2>
        <p className="card__note">
          Поданные в период — по состоянию сейчас. Из каждых ста дошло{' '}
          {current.conversion === null ? '—' : Math.round(current.conversion * 100)}.
          {cut.funnel.expired > 0
            ? ` Из отменённых ${cut.funnel.expired} закрылись по сроку оплаты.`
            : ''}
        </p>
        <Funnel
          total={current.submitted}
          steps={cut.funnel.stages.map((stage) => ({
            label: STATUS_LABELS[stage.status],
            count: stage.count,
            tone:
              stage.status === 'completed'
                ? 'up'
                : stage.status === 'cancelled'
                  ? 'down'
                  : stage.status === 'new'
                    ? 'plain'
                    : 'wait',
          }))}
        />
      </section>

      {tables.map((table) => (
        <section key={table.key} className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">{table.title}</h2>
              <p className="card__note">{table.note}</p>
            </div>
            <a
              className="btn btn--ghost btn--tiny"
              href={`/api/analytics/csv?kind=${table.key}&step=${step}&${query.toString()}`}
            >
              CSV
            </a>
          </div>
          <div className="scroll-x">
            <table className="datatable">
              <thead>
                <tr>
                  {table.columns.map((column, index) => (
                    <th key={column} className={index === 0 ? undefined : 'num'}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  // Шаг или час без единой заявки — строка с нулями, а не
                  // пропуск: таблица, из которой выпали дни, читается как
                  // таблица без провалов. Приглушена, чтобы не спорить за
                  // внимание с теми строками, в которых что-то было.
                  <tr
                    key={String(row[0])}
                    className={
                      row.every((cell) => typeof cell !== 'number' || cell === 0)
                        ? 'datatable__row--empty'
                        : undefined
                    }
                  >
                    {row.map((cell, index) => (
                      <td key={table.columns[index] ?? index} className={index === 0 ? undefined : 'num'}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}

/** Точки динамики — строками: `Date` и `Amount` через границу клиента не едут. */
function toPoints(
  series: Awaited<ReturnType<typeof merchantBreakdowns>>['series'],
): { at: string; submitted: number; completed: number; cancelled: number; turnover: { code: string; amount: string }[] }[] {
  return series.map((one) => ({
    at: one.at,
    submitted: one.submitted,
    completed: one.completed,
    cancelled: one.cancelled,
    turnover: one.turnover.map((line) => ({ code: line.code, amount: String(line.amount) })),
  }));
}
