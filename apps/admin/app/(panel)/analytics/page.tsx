import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CoreError, type ExchangeSummary } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { STATUS_LABELS } from '@/lib/exchange-request-labels';
import { averageByCurrency, compareByCurrency, formatByCurrency } from '@/lib/money-list';
import { PERIOD_LABELS, TZ_COOKIE, dayOf, readTzOffset, resolvePeriod } from '@/lib/period';
import { Funnel } from '@/app/ui/funnel';
import { HowTo } from '@/app/ui/howto';
import { Moment } from '@/app/ui/moment';
import { Stat, Stats, type StatTone } from '@/app/ui/stat';
import { PeriodChips } from './period-chips';

export const dynamic = 'force-dynamic';

/**
 * Аналитика: сводка за период и воронка заявок.
 *
 * Только администратору: доход сервиса — экономика, которую видит он
 * один. Числа сравниваются с таким же по длине периодом прямо перед
 * выбранным; деньги показываются по каждой валюте отдельно — курса,
 * которым их можно было бы свести, у сервиса нет.
 */

const HOW_TO = [
  {
    title: 'С чем сравнивается',
    detail:
      'Каждое число — с таким же по длине периодом прямо перед выбранным: тридцать дней с ' +
      'предыдущими тридцатью, а не с прошлым месяцем календаря.',
  },
  {
    title: 'Заявки — по подаче, деньги — по исполнению',
    detail:
      'В период попадают заявки, поданные в его границах, — так конверсия остаётся честной. ' +
      'Оборот и доход считаются по дате исполнения: это то, что сервис получил в эти дни.',
  },
  {
    title: 'Валюты не складываются',
    detail:
      'Оборот в рублях и оборот в USDT — два числа рядом. Исторического курса у сервиса нет, ' +
      'и одно число вместо двух читалось бы как факт, которого не было.',
  },
  {
    title: 'Что такое доход',
    detail:
      'Сумма, которую менеджер назвал при исполнении каждой заявки, — та же, от которой ' +
      'начисляются баллы рефереру. Оборот — то, что клиенты отдали.',
  },
];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const params = await searchParams;
  const jar = await cookies();
  const offset = readTzOffset(jar.get(TZ_COOKIE)?.value);
  const period = resolvePeriod(
    {
      period: single(params.period),
      from: single(params.from),
      to: single(params.to),
    },
    new Date(),
    offset,
  );

  try {
    const core = getCore();
    const [{ current, previous }, { byDay, byManager }] = await Promise.all([
      core.summarizeExchangeRequests(actor, period),
      core.breakdownExchangeRequests(actor, period, { offsetMinutes: offset }),
    ]);
    const csvQuery = new URLSearchParams({
      period: period.key,
      from: dayOf(period.from, offset),
      to: dayOf(new Date(period.to.getTime() - 1), offset),
    }).toString();
    const lastDay = new Date(period.to.getTime() - 1);

    return (
      <main className="page page--wide">
        <header className="page__head">
          <div>
            <h1 className="page__title">Аналитика</h1>
            <p className="page__sub">
              {PERIOD_LABELS[period.key]}: <Moment at={period.from.toISOString()} mode="day" /> —{' '}
              <Moment at={lastDay.toISOString()} mode="day" />
              {offset === 0 ? ' · дни считаются по UTC' : ''}
            </p>
          </div>
        </header>

        <HowTo
          title="Как читать аналитику"
          sub="Откуда числа и с чем они сравниваются"
          items={HOW_TO}
        />

        <PeriodChips
          current={period.key}
          from={dayOf(period.from, offset)}
          to={dayOf(lastDay, offset)}
        />

        <Stats>
          <Stat
            label="Подано"
            value={current.submitted}
            note={was(previous.submitted, 'заявок')}
            tone={trend(current.submitted, previous.submitted)}
          />
          <Stat
            label="Исполнено"
            value={current.completed}
            note={was(previous.completed, 'по дате исполнения')}
            tone={trend(current.completed, previous.completed)}
          />
          <Stat
            label="Отменено"
            value={current.cancelled}
            note={was(previous.cancelled, 'по дате отмены')}
            tone={current.cancelled > previous.cancelled ? 'down' : 'plain'}
          />
          <Stat
            label="Конверсия"
            value={percent(current.conversion)}
            note={
              current.conversion === null
                ? 'поданных в период нет'
                : `исполнено из поданных · было ${percent(previous.conversion)}`
            }
            tone={trendNullable(current.conversion, previous.conversion)}
          />
          <Stat
            label="В работе"
            value={current.open}
            note="из поданных в период"
            tone={current.open ? 'wait' : 'plain'}
          />
          <Stat
            label="До исполнения"
            value={minutes(current.averageMinutesToComplete)}
            note={
              previous.averageMinutesToComplete === null
                ? 'в среднем от подачи до исполнения'
                : `в среднем · было ${minutes(previous.averageMinutesToComplete)}`
            }
          />
        </Stats>

        <div className="grid">
          <MoneyCard
            title="Оборот"
            note="Отдано клиентами по исполненным заявкам"
            now={current}
            before={previous}
            pick={(one) => one.turnover}
          />
          <MoneyCard
            title="Доход сервиса"
            note="Названный при исполнении — база реферальных начислений"
            now={current}
            before={previous}
            pick={(one) => one.income}
          />
          <section className="card">
            <h2 className="card__title">Средний чек</h2>
            <p className="card__note">Оборот на число исполненных заявок — по каждой валюте</p>
            <p className="money">{formatByCurrency(averageByCurrency(current.turnover))}</p>
            <p className="muted">было {formatByCurrency(averageByCurrency(previous.turnover))}</p>
          </section>
        </div>

        <section className="card">
          <h2 className="card__title">Воронка заявок</h2>
          <p className="card__note">
            Поданные в период — по состоянию сейчас. Из каждых ста поданных исполнено{' '}
            {current.conversion === null ? '—' : Math.round(current.conversion * 100)}.
          </p>
          <Funnel
            total={current.submitted}
            steps={current.funnel.map((step) => ({
              label: STATUS_LABELS[step.status],
              count: step.count,
              tone:
                step.status === 'completed'
                  ? 'up'
                  : step.status === 'cancelled'
                    ? 'down'
                    : step.status === 'new'
                      ? 'plain'
                      : 'wait',
            }))}
          />
        </section>

        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">По дням</h2>
              <p className="card__note">
                Подано и отменено — по своим датам, оборот — по исполнению
              </p>
            </div>
            <a
              className="btn btn--ghost btn--tiny"
              href={`/api/analytics/csv?kind=day&${csvQuery}`}
            >
              CSV
            </a>
          </div>
          <div className="scroll-x">
            <table className="datatable">
              <thead>
                <tr>
                  <th>День</th>
                  <th className="num">Подано</th>
                  <th className="num">Исполнено</th>
                  <th className="num">Отменено</th>
                  <th className="num">Оборот</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((row) => (
                  <tr
                    key={row.day}
                    className={
                      row.submitted + row.completed + row.cancelled === 0
                        ? 'datatable__row--empty'
                        : ''
                    }
                  >
                    <td>{row.day}</td>
                    <td className="num">{row.submitted}</td>
                    <td className="num">{row.completed}</td>
                    <td className="num">{row.cancelled}</td>
                    <td className="num">{formatByCurrency(row.turnover)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">По сотрудникам</h2>
              <p className="card__note">
                Исполнено и отменено за период; переданная заявка считается исполнившему
              </p>
            </div>
            <a
              className="btn btn--ghost btn--tiny"
              href={`/api/analytics/csv?kind=manager&${csvQuery}`}
            >
              CSV
            </a>
          </div>
          {byManager.length ? (
            <div className="scroll-x">
              <table className="datatable">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th className="num">Исполнил</th>
                    <th className="num">Отменил</th>
                    <th className="num">Ведёт сейчас</th>
                    <th className="num">Доход</th>
                  </tr>
                </thead>
                <tbody>
                  {byManager.map((row) => (
                    <tr key={row.staffId}>
                      <td>{row.displayName}</td>
                      <td className="num">{row.completed}</td>
                      <td className="num">{row.cancelled}</td>
                      <td className="num">{row.open}</td>
                      <td className="num">{formatByCurrency(row.income)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">За период никто не исполнял и не отменял заявок.</p>
          )}
        </section>
      </main>
    );
  } catch (error) {
    // Менеджер сюда зашёл по прямой ссылке: показываем отказ, а не
    // страницу входа — войти он как раз может, просто не сюда.
    if (error instanceof CoreError && error.code === 'forbidden') {
      return (
        <main className="page">
          <h1 className="page__title">Аналитика</h1>
          <p className="empty">
            Раздел доступен только администратору: здесь доход и оборот сервиса. Свои числа за
            сегодня видны на столе, в обзоре.
          </p>
        </main>
      );
    }
    throw error;
  }
}

function MoneyCard({
  title,
  note,
  now,
  before,
  pick,
}: {
  title: string;
  note: string;
  now: ExchangeSummary;
  before: ExchangeSummary;
  pick: (summary: ExchangeSummary) => ExchangeSummary['turnover'];
}) {
  const lines = pick(now);
  const compared = compareByCurrency(lines, pick(before));
  return (
    <section className="card">
      <h2 className="card__title">{title}</h2>
      <p className="card__note">{note}</p>
      <p className="money">{formatByCurrency(lines)}</p>
      {compared.length ? (
        <ul className="rows rows--tight">
          {compared.map((one) => (
            <li key={one.code} className={`delta delta--${one.delta}`}>
              {one.code}: было {formatByCurrency([{ code: one.code, amount: one.before }])}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">было {formatByCurrency(pick(before))}</p>
      )}
    </section>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  const one = Array.isArray(value) ? value[0] : value;
  return one?.trim() || undefined;
}

function was(before: number, what: string): string {
  return `${what} · было ${before}`;
}

function trend(now: number, before: number): StatTone {
  if (now > before) return 'up';
  if (now < before) return 'down';
  return 'plain';
}

function trendNullable(now: number | null, before: number | null): StatTone {
  if (now === null || before === null) return 'plain';
  return trend(now, before);
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)} %`;
}

function minutes(value: number | null): string {
  if (value === null) return '—';
  if (value < 60) return `${Math.round(value)} мин`;
  const hours = value / 60;
  if (hours < 48) return `${hours.toFixed(1).replace('.', ',')} ч`;
  return `${(hours / 24).toFixed(1).replace('.', ',')} дн`;
}
