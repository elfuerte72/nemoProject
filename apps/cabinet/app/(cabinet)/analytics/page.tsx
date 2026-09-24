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
  IntegrationTiles,
  Moment,
  PeriodChips,
  QuietRefresh,
  Stat,
  Stats,
  trendTone,
} from '@nemo/ui';
import { formatMoney } from '@nemo/ui/format';
import { averageByCurrency } from '@nemo/ui/money-list';
import { PERIOD_LABELS, TZ_COOKIE, readTzOffset } from '@nemo/ui/period';
import { exchangeRequestStatuses, merchantRoleCan, type ExchangeRequestStatus } from '@nemo/types';
import {
  ANALYTICS_HOW_TO,
  ANALYTICS_STEP_KEYS,
  ANALYTICS_STEP_LABELS,
  OUTCOME_LABELS,
  WEEKDAY_LABELS,
} from '@/lib/analytics-texts';
import { analyticsTables, type AnalyticsTableKey } from '@/lib/analytics-rows';
import { analyticsSearch, readAnalyticsQuery } from '@/lib/analytics-query';
import {
  axisLabel,
  monthEstimate,
  outcomeRows,
  perDay,
  requestsPerDay,
  shareOf,
  type OutcomeKey,
} from '@/lib/analytics-view';
import { STATUS_LABELS } from '@/lib/labels';
import { merchantBreakdowns, merchantStats, viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { MoneyFlags } from '@/app/ui/money-flags';
import { DataTable } from './as-table';
import { ColumnChart } from './column-chart';
import { Dynamics } from './dynamics';
import { Heatmap } from './heatmap';
import { RefreshButton } from './refresh';
import { Slices } from './slices';

export const dynamic = 'force-dynamic';

/**
 * Аналитика мерчанта — по образцу раздела Love&Pay (24 сентября 2026):
 * фильтры одной строкой сверху, плитки показателей, динамика, воронка и
 * состояния, часы, дни недели и карта нагрузки, сотрудники, получатели,
 * валюты и прочие разрезы, сроки, рекорды с прогнозом; у каждого блока
 * выгрузка, у страницы — отчёт целиком.
 *
 * Взято устройство, а не предмет: у образца за числами стоят счета
 * кассы, у нас — заявки на обмен. Поэтому «клиенты» образца здесь —
 * получатели, «каналы приёма» — источники заявки, «время до оплаты» —
 * срок до исполнения. Чего у заявки нет вовсе — возвратов, наценки
 * мерчанта, проверки личности, — того нет и на экране (`backlog.md`):
 * блок из нулей обещал бы то, чего сервис не делает.
 *
 * Своим пунктом меню раздел стоит с 24 сентября 2026; кнопка на обзоре
 * осталась и ведёт в тот же период. Плитки, ушедшие с обзора, — срок до
 * исполнения, конверсия, средний чек, вызовы API и доставки вебхуков —
 * живут здесь.
 *
 * Числа — по правилам ADR-0013 и той же операцией, что у панели:
 * заявки по дате подачи, деньги по дате исполнения, валюты не
 * складываются никогда. Период, шаг и «только мои» живут в адресе:
 * считает их сервер, а ссылку на свой разрез можно переслать.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, session } = await viewer();
  const params = await searchParams;
  const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
  const now = new Date();
  const query = readAnalyticsQuery((name) => firstParam(params[name]), actor, now, offset);
  const { period, lastDay, step } = query;

  const [stats, cut] = await Promise.all([
    merchantStats(period.from.getTime(), period.to.getTime(), offset, 'day', query.submittedBy ?? ''),
    merchantBreakdowns(
      period.from.getTime(),
      period.to.getTime(),
      offset,
      step,
      query.submittedBy ?? '',
    ),
  ]);
  const { current, previous } = stats;
  const tables = analyticsTables(cut, { offsetMinutes: offset });
  const tableOf = (key: AnalyticsTableKey) => tables.find((one) => one.key === key) ?? null;
  // Показатели и отчёт выгружаются всегда; разрез — когда в нём есть строки.
  const csvOf = (key: AnalyticsTableKey | 'report') =>
    key === 'report' || key === 'summary' || tableOf(key)
      ? `/api/analytics/csv?kind=${key}&${analyticsSearch(query)}`
      : null;
  const href = (over: Record<string, string | undefined>) => `/analytics?${analyticsSearch(query, over)}`;

  // Валюты переключателя динамики — те, в которых оборот был: кнопка
  // «RUB» без единой сделки в рублях обещала бы ряд, за которым пусто.
  const currencies = [...new Set(cut.series.flatMap((one) => one.turnover.map((line) => line.code)))]
    .sort((a, b) => a.localeCompare(b));
  const clock = offset === 0 ? 'по UTC' : 'по вашим часам';
  const anything = current.submitted > 0 || current.completed > 0 || current.cancelled > 0;
  const submitted = cut.funnel.stages.reduce((total, one) => total + one.count, 0);
  const previousFrom = new Date(period.from.getTime() - (period.to.getTime() - period.from.getTime()));
  const previousLast = new Date(period.from.getTime() - 1);

  return (
    <main className="page page--wide">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Аналитика</h1>
          <p className="page__sub">Показатели, динамика, разрезы и выгрузка</p>
        </div>
        <div className="page__actions">
          <RefreshButton />
          <a className="btn btn--gold btn--tiny" href={csvOf('report') ?? undefined}>
            Выгрузить отчёт
          </a>
        </div>
      </header>

      <HowTo
        title="Как читать аналитику"
        sub="Откуда числа и с чем они сравниваются"
        items={ANALYTICS_HOW_TO}
      />

      {/*
        Фильтры одной строкой над всем, что они сужают: период, шаг и
        «чьи заявки». Каждый блок ниже считается по тому же срезу, и
        числа между блоками сходятся.
      */}
      <div className="anbar">
        <PeriodChips
          current={period.key}
          basePath="/analytics"
          // «Сегодня» — не с образца, а с обзора: кнопка «Аналитика»
          // переносит его период, и чип должен быть отмечен и здесь.
          quick={['today', '7d', '30d', '90d', '365d']}
          customChip
          from={query.base.from ?? ''}
          to={query.base.to ?? ''}
          keep={{
            ...(query.stepKey === 'auto' ? {} : { step: query.stepKey }),
            ...(query.mine ? { mine: '1' } : {}),
          }}
        />
        <div className="anbar__right">
          <nav className="seg" aria-label="Шаг динамики">
            {ANALYTICS_STEP_KEYS.map((key) => (
              <Link
                key={key}
                href={href({ step: key === 'auto' ? undefined : key })}
                className={key === query.stepKey ? 'seg__item seg__item--on' : 'seg__item'}
                aria-current={key === query.stepKey ? 'true' : undefined}
                scroll={false}
              >
                {ANALYTICS_STEP_LABELS[key]}
              </Link>
            ))}
          </nav>
          {/*
            «Чьи заявки» — тем же переключателем, что «Счета всех
            сотрудников» на «Счетах»: один вопрос в кабинете задаётся
            одним способом. Ссылкой, а не кнопкой: отбор живёт в адресе.
            Наблюдателю его нет — своих заявок у него не бывает.
          */}
          {query.canNarrow ? (
            <Link
              className={query.mine ? 'switch' : 'switch switch--on'}
              href={href({ mine: query.mine ? undefined : '1' })}
              aria-label={
                query.mine
                  ? 'Показаны только ваши заявки. Показать заявки всех сотрудников'
                  : 'Показаны заявки всех сотрудников. Показать только ваши'
              }
              scroll={false}
            >
              <span className="switch__track" aria-hidden />
              Заявки всех сотрудников
            </Link>
          ) : undefined}
        </div>
      </div>
      <p className="anbar__meta">
        {PERIOD_LABELS[period.key]}: <Moment at={period.from.toISOString()} mode="day" /> —{' '}
        <Moment at={lastDay.toISOString()} mode="day" /> · сравнение с{' '}
        <Moment at={previousFrom.toISOString()} mode="day" /> —{' '}
        <Moment at={previousLast.toISOString()} mode="day" /> · обновлено{' '}
        <Moment at={now.toISOString()} />
        {offset === 0 ? ' · дни и часы по UTC' : ''}
        {query.mine ? ' · только ваши заявки' : ''}
      </p>

      <Stats>
        <Stat
          wide
          label="Оборот"
          value={<MoneyFlags lines={current.turnover} before={previous.turnover} />}
          note="отдано по исполненным в период, каждая валюта отдельно"
        />
        <Stat
          wide
          label="Средний чек"
          value={
            <MoneyFlags
              lines={averageByCurrency(current.turnover)}
              before={averageByCurrency(previous.turnover)}
            />
          }
          note={
            cut.medianTicket.length === 0
              ? 'оборот на число исполненных'
              : `медиана ${cut.medianTicket.map((one) => formatMoney(one.amount, one.code)).join(' · ')}`
          }
        />
        {/*
          «В работе» здесь нет: плитка про «сейчас», а не про период, и то
          же число стоит строкой воронки ниже.
        */}
        <ExchangeCountTiles current={current} previous={previous} open={false} />
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
        <Stat
          label="Получателей"
          value={cut.recipients.total}
          note={
            cut.recipients.total === 0
              ? 'в период заявок никому не подавали'
              : `впервые ${cut.recipients.fresh} · вернулись ${cut.recipients.returning}`
          }
        />
        {/*
          Вызовы и доставки — кабинета, а не человека: ключ ничей. В
          отборе «только мои» их нет, иначе плитка выдала бы общие числа
          за свои. Ссылкой плитка ведёт только того, кому открыта
          интеграция: оператору и наблюдателю журнал вызовов отказал бы.
        */}
        {query.mine ? undefined : (
          <IntegrationTiles
            apiCalls={current.apiCalls}
            webhookDeliveries={current.webhookDeliveries}
            {...(merchantRoleCan(session.role, 'integration')
              ? { callsHref: '/calls', webhooksHref: '/webhooks' }
              : {})}
          />
        )}
      </Stats>

      {anything ? (
        <>
          <Dynamics
            points={cut.series.map((one) => ({
              at: one.at,
              submitted: one.submitted,
              completed: one.completed,
              cancelled: one.cancelled,
              recipients: one.recipients,
              turnover: one.turnover.map((line) => ({ code: line.code, amount: String(line.amount) })),
            }))}
            currencies={currencies}
            step={step}
            coarsened={query.coarsened}
            csvHref={csvOf('series')}
            table={tableOf('series')}
          />

          <div className="duo">
            <Block title="Воронка заявок" note="Куда ушли поданные в период — по состоянию сейчас" csv={csvOf('outcome')}>
              <Funnel
                total={submitted}
                steps={outcomeRows(cut.funnel).map((one) => ({
                  label: OUTCOME_LABELS[one.key],
                  count: one.count,
                  tone: OUTCOME_TONES[one.key],
                }))}
              />
              <p className="card__note">
                {submitted === 0
                  ? 'Поданных в период нет.'
                  : `Из каждых ста поданных исполнено ${Math.round(((current.conversion ?? 0) * 100))}.`}
                {current.averageMinutesToComplete === null
                  ? ''
                  : ` В среднем заявка исполняется за ${formatMinutes(current.averageMinutesToComplete)} после подачи.`}
              </p>
            </Block>

            <Block title="Состояния" note="В каком состоянии поданные в период сейчас" csv={csvOf('status')}>
              <StateBar
                total={submitted}
                counts={exchangeRequestStatuses.map((status) => ({
                  status,
                  count: cut.funnel.stages.find((one) => one.status === status)?.count ?? 0,
                }))}
              />
            </Block>
          </div>

          <div className="duo">
            <Block title="Часы подачи" note={`Когда подают заявки, ${clock}`} csv={csvOf('hour')}>
              <ColumnChart
                label="Поданные по часам суток"
                unit="подано"
                columns={cut.byHour.map((one) => ({
                  key: String(one.hour),
                  axis: one.hour % 3 === 0 ? String(one.hour) : '',
                  minor: one.hour % 6 !== 0,
                  title: `${String(one.hour).padStart(2, '0')}:00–${String(one.hour + 1).padStart(2, '0')}:00`,
                  value: one.submitted,
                  said: String(one.submitted),
                }))}
              />
            </Block>
            <Block title="Дни недели" note="Сильные и слабые дни — по поданным" csv={csvOf('weekday')}>
              <Weekdays days={cut.byWeekday} />
            </Block>
          </div>

          <Block title="Карта нагрузки" note={`Поданные по дням недели и часам, ${clock}`} csv={csvOf('load')}>
            <Heatmap rows={cut.load} days={WEEKDAY_LABELS} />
          </Block>

          <Block title="Сотрудники" note="Кто сколько подал за период" csv={csvOf('staff')}>
            <TableOrEmpty table={tableOf('staff')} empty="За период никто не подавал заявок" />
          </Block>

          <Block title="Получатели" note={tableOf('recipient')?.note ?? 'Кому платили'} csv={csvOf('recipient')}>
            <p className="tally">
              <span className="tally__item">
                С заявками в период: <b>{cut.recipients.total}</b>
              </span>
              <span className="tally__item">
                Впервые: <b>{cut.recipients.fresh}</b>
              </span>
              <span className="tally__item">
                Вернулись: <b>{cut.recipients.returning}</b>{' '}
                ({formatShare(shareOf(cut.recipients.returning, cut.recipients.total))})
              </span>
            </p>
            <TableOrEmpty
              table={tableOf('recipient')}
              empty="Поданных получателям заявок за период нет"
              render={(column, cell) =>
                column === 1 && cell === 'да' ? <span className="pill">впервые</span> : cell
              }
            />
          </Block>

          <Slices
            slices={(
              [
                ['direction', 'Направления', 'Что на что меняли'],
                ['method', 'Способы выдачи', 'Куда уходили деньги: на банк, на кошелёк или наличными'],
                ['source', 'Источники', 'Сколько прошло через интеграцию, а сколько завели руками'],
              ] as const
            ).flatMap(([key, label, note]) => {
              const table = tableOf(key);
              const csvHref = csvOf(key);
              return table && csvHref ? [{ key, label, note, table, csvHref }] : [];
            })}
          />

          <div className="trio">
            <Block title="Валюты" note="Отдано вами и получено получателями, по исполненным" csv={csvOf('currency')}>
              <TableOrEmpty table={tableOf('currency')} empty="Исполненных заявок за период нет" />
            </Block>
            <Block
              title="До исполнения"
              note="Сколько заявка шла от подачи до денег у получателя"
              csv={csvOf('summary')}
            >
              <dl className="kv">
                <Pair name="В среднем" value={formatMinutes(current.averageMinutesToComplete)} />
                <Pair name="Медиана" value={formatMinutes(cut.records.medianMinutes)} />
                <Pair
                  name="Быстрее всех"
                  value={
                    cut.records.fastest ? (
                      <Link href={`/requests/${cut.records.fastest.requestId}`}>
                        {formatMinutes(cut.records.fastest.minutes)}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <Pair
                  name="Дольше всех"
                  value={
                    cut.records.slowest ? (
                      <Link href={`/requests/${cut.records.slowest.requestId}`}>
                        {formatMinutes(cut.records.slowest.minutes)}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
              </dl>
            </Block>

            <Block title="Рекорды и прогноз" note="Что выбивалось из ряда и куда ведёт темп" csv={csvOf('summary')}>
              <dl className="kv">
                <Pair
                  name="Лучший день"
                  value={
                    cut.records.bestDay
                      ? `${axisLabel(cut.records.bestDay.at, 'day')} · исполнено ${cut.records.bestDay.completed}`
                      : '—'
                  }
                />
                <Pair
                  name="Крупнейшая заявка"
                  value={
                    cut.records.largest.length === 0 ? (
                      '—'
                    ) : (
                      <span className="kv__list">
                        {cut.records.largest.map((one) => (
                          <Link key={one.code} href={`/requests/${one.requestId}`}>
                            {formatMoney(one.amount, one.code)}
                          </Link>
                        ))}
                      </span>
                    )
                  }
                />
                <Pair name="В среднем в день" value={<MoneyLines lines={perDay(current.turnover, query.paceDays)} />} />
                <Pair
                  name="Заявок в день"
                  value={String(requestsPerDay(current.submitted, query.paceDays)).replace('.', ',')}
                />
                <Pair
                  name="Оценка на месяц"
                  value={<MoneyLines lines={monthEstimate(current.turnover, query.paceDays)} />}
                  hint="тридцать дней при том же темпе"
                />
              </dl>
            </Block>
          </div>
        </>
      ) : (
        <EmptyState
          icon="chart"
          title={query.mine ? 'Ваших заявок за этот период нет' : 'За этот период заявок нет'}
          text={
            query.mine
              ? 'Здесь только заявки, поданные вами. Включите «Заявки всех сотрудников» или возьмите период шире.'
              : 'Графики и разрезы появятся, как только в период попадёт хотя бы одна заявка. Возьмите период шире.'
          }
        />
      )}
    </main>
  );
}

const OUTCOME_TONES: Record<OutcomeKey, 'plain' | 'up' | 'down' | 'wait'> = {
  submitted: 'plain',
  completed: 'up',
  open: 'wait',
  expired: 'down',
  cancelled: 'down',
};

/** Блок раздела: заголовок, пояснение, выгрузка справа, содержимое ниже. */
function Block({
  title,
  note,
  csv,
  children,
}: {
  readonly title: string;
  readonly note: string;
  /** Выгрузка блока. Пусто — выгружать нечего, и кнопки нет. */
  readonly csv: string | null;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 className="card__title">{title}</h2>
          <p className="card__note">{note}</p>
        </div>
        {csv ? (
          <a className="btn btn--ghost btn--tiny" href={csv}>
            CSV
          </a>
        ) : undefined}
      </div>
      {children}
    </section>
  );
}

function TableOrEmpty({
  table,
  empty,
  render,
}: {
  readonly table: ReturnType<typeof analyticsTables>[number] | null;
  readonly empty: string;
  readonly render?: (column: number, cell: string | number) => React.ReactNode;
}) {
  if (!table) return <p className="muted">{empty}</p>;
  return <DataTable table={table} {...(render ? { render } : {})} />;
}

/**
 * Состояния одной полосой — доля каждого среди поданных, и список под
 * ней с числами. Цвет по пути заявки: от светлого у новой к тёмному у
 * исполненной — один оттенок, пять ступеней, проверенных валидатором
 * скилла `dataviz`; отменённая — цветом отказа, он и значит «плохо».
 * Цвет не единственный ключ: у каждой строки списка есть слово и число.
 */
function StateBar({
  total,
  counts,
}: {
  readonly total: number;
  readonly counts: readonly { readonly status: ExchangeRequestStatus; readonly count: number }[];
}) {
  return (
    <>
      <div className="statebar" aria-hidden="true">
        {counts
          .filter((one) => one.count > 0)
          .map((one) => (
            <span
              key={one.status}
              className={`statebar__seg statebar__seg--${one.status}`}
              style={{ flexGrow: one.count }}
            />
          ))}
      </div>
      <ul className="statelist">
        {counts.map((one) => (
          <li key={one.status} className={one.count === 0 ? 'statelist__row statelist__row--none' : 'statelist__row'}>
            <span className={`statelist__key statebar__seg--${one.status}`} aria-hidden="true" />
            <span className="statelist__name">{STATUS_LABELS[one.status]}</span>
            <b className="statelist__count">{one.count}</b>
            <span className="statelist__share">{formatShare(shareOf(one.count, total))}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Дни недели полосами: число видно сразу, без наведения. */
function Weekdays({
  days,
}: {
  readonly days: readonly { readonly weekday: number; readonly submitted: number }[];
}) {
  const top = Math.max(1, ...days.map((one) => one.submitted));
  const total = days.reduce((sum, one) => sum + one.submitted, 0);
  return (
    <ul className="hbars">
      {days.map((one) => (
        <li key={one.weekday} className="hbars__row">
          <span className="hbars__name">{WEEKDAY_LABELS[one.weekday - 1]}</span>
          <span className="hbars__track" aria-hidden="true">
            <span className="hbars__fill" style={{ width: `${(one.submitted / top) * 100}%` }} />
          </span>
          <b className="hbars__count">{one.submitted}</b>
          <span className="hbars__share">{formatShare(shareOf(one.submitted, total))}</span>
        </li>
      ))}
    </ul>
  );
}

/** Деньги по валютам в строке «имя — значение»: каждая валюта своей строкой, без сложения. */
function MoneyLines({ lines }: { readonly lines: readonly { code: string; amount: string }[] }) {
  if (lines.length === 0) return <>—</>;
  return (
    <span className="kv__list">
      {lines.map((one) => (
        <span key={one.code}>{formatMoney(one.amount, one.code)}</span>
      ))}
    </span>
  );
}

function Pair({
  name,
  value,
  hint,
}: {
  readonly name: string;
  readonly value: React.ReactNode;
  readonly hint?: string;
}) {
  return (
    <div className="kv__row">
      <dt className="kv__name">
        {name}
        {hint ? <span className="kv__hint">{hint}</span> : undefined}
      </dt>
      <dd className="kv__value">{value}</dd>
    </div>
  );
}
