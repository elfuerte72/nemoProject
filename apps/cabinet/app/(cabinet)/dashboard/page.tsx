import { cookies } from 'next/headers';
import Link from 'next/link';
import {
  EmptyState,
  ExchangeCountTiles,
  firstParam,
  formatShare,
  Greeting,
  IntegrationTiles,
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
import { merchantRoleCan, WEBHOOK_ENDPOINT_STATE_LABELS } from '@nemo/types';
import { attentionOf } from '@/lib/attention';
import { getCore } from '@/lib/core';
import { STATUS_LABELS, STATUS_TONES } from '@/lib/labels';
import { merchantStats, openCount, requestCounts, viewer } from '@/lib/reads';
import { AttentionLine } from '@/app/ui/attention-line';
import { DisabledBanner } from '@/app/ui/disabled-banner';

export const dynamic = 'force-dynamic';

/**
 * Обзор: что происходит прямо сейчас и что было за период.
 *
 * Числа — по правилам аналитики панели (docs/adr/0013), той же
 * операцией, которой сотрудник смотрит карточку мерчанта: «у нас
 * исполнено двенадцать» и «у вас одиннадцать» — разговор, который лучше
 * не начинать. Период живёт в адресе, «сегодня» — по часам браузера и
 * приходит тем же ответом, что плитки. Последние заявки остаются на
 * первом экране: обзор открывают, чтобы взглянуть на заявку, а не
 * только на плитки.
 *
 * Подсказки «как это устроено» здесь нет с 20 сентября 2026. Она
 * занимала полосу между приветствием и числами — то самое место, куда
 * смотрят первым, — и объясняла то, что уже подписано под каждой
 * плиткой: «по дате исполнения», «из поданных в период». Обзор
 * открывают каждый день, а объяснение нужно один раз; постоянный блок,
 * ни разу не понадобившийся, глаз начинает перепрыгивать. В разделах,
 * где правила неочевидны — вебхуки, счета, возвраты, песочница, — она
 * осталась.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, session } = await viewer();
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

  const core = getCore();
  /*
   * Ключи и вебхуки спрашиваются только у того, кому они видны:
   * оператору и наблюдателю операция откажет (тикет 17), и обзор — не
   * то место, где человек узнаёт об этом пятисотым ответом.
   */
  const ownsIntegration = merchantRoleCan(session.role, 'integration');
  const [stats, recent, counts, keys, hooks] = await Promise.all([
    merchantStats(period.from.getTime(), period.to.getTime(), offset),
    core.listExchangeRequests(actor, { limit: 5 }),
    requestCounts(),
    ownsIntegration ? core.listApiKeys(actor) : Promise.resolve([]),
    ownsIntegration ? core.listWebhookEndpoints(actor) : Promise.resolve([]),
  ]);
  const { current, previous, today } = stats;
  const active = openCount(counts);
  const lastDay = new Date(period.to.getTime() - 1);
  const csvQuery = new URLSearchParams({
    period: period.key,
    from: dayOf(period.from, offset),
    to: dayOf(lastDay, offset),
  }).toString();
  const maxDay = Math.max(1, ...stats.byDay.map((one) => Math.max(one.submitted, one.completed)));
  const liveKeys = keys.filter((one) => one.revokedAt === null).length;
  const failingHooks = hooks.filter((one) => one.state === 'failing');
  const clock = offset === 0 ? 'по UTC' : 'по вашим часам';
  /*
   * Точки спрошены только у того, кому видна интеграция, и тревоги по
   * ним у оператора не будет: вести его туда некуда — операция ему
   * откажет.
   */
  const attention = attentionOf({
    endpoints: hooks,
    deliveries: current.webhookDeliveries,
    apiCalls: current.apiCalls,
  });

  return (
    <main className="page">
      <QuietRefresh />
      <DisabledBanner status={session.status} />
      {/*
        Первым на экране — то, что требует действия сегодня, и только
        потом числа за период: мерчант со сломанной интеграцией теряет
        оплаты, пока смотрит на средний чек. Тихо — строки нет вовсе.
      */}
      <AttentionLine one={attention} />

      <header className="page__head">
        <div>
          <Greeting name={session.name} />
          <p className="page__sub">
            {active > 0
              ? `Незакрытых заявок: ${active}. Открытая заявка ждёт либо вас, либо менеджера.`
              : 'Незакрытых заявок нет.'}
          </p>
        </div>
      </header>

      <p className="today">
        <span className="today__label">Сегодня</span>
        <span>
          подано <b>{today.submitted}</b>
        </span>
        <span>
          исполнено <b>{today.completed}</b>
        </span>
        <span>
          отменено <b>{today.cancelled}</b>
        </span>
        <span className="today__note">{clock}</span>
      </p>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {PERIOD_LABELS[period.key]}: <Moment at={period.from.toISOString()} mode="day" /> —{' '}
            <Moment at={lastDay.toISOString()} mode="day" />
          </h2>
          <span className="section__rule" />
          {/*
            Вход в аналитику стоит здесь, а не в меню: отдельный пункт
            обещал бы вторую правду о тех же числах, а разрезы за них
            спрашивают тогда же, когда смотрят на плитки.
          */}
          <Link className="btn btn--soft btn--tiny" href={`/analytics?${csvQuery}`}>
            Подробнее
          </Link>
          <a className="btn btn--ghost btn--tiny" href={`/api/requests/csv?${csvQuery}`}>
            CSV заявок
          </a>
        </div>

        <PeriodChips
          current={period.key}
          basePath="/dashboard"
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
          <IntegrationTiles
            apiCalls={current.apiCalls}
            webhookDeliveries={current.webhookDeliveries}
            callsHref="/calls"
            webhooksHref="/webhooks"
          />
        </Stats>

        <div className="grid">
          <section className="card">
            <h2 className="card__title">Оборот</h2>
            <p className="card__note">Отдано по исполненным заявкам — по каждой валюте отдельно</p>
            <MoneyCompare now={current.turnover} before={previous.turnover} />
          </section>

          <section className="card">
            <h2 className="card__title">Средний чек</h2>
            <p className="card__note">Оборот на число исполненных заявок — по каждой валюте</p>
            {/*
              Карточкой, а не плиткой: у мерчанта две валюты отдачи и
              больше, а плитка рассчитана на одно число — двумя она
              разъезжается на три строки и забирает полосу себе.
            */}
            <p className="money">{formatByCurrency(averageByCurrency(current.turnover))}</p>
            <p className="muted">было {formatByCurrency(averageByCurrency(previous.turnover))}</p>
          </section>

          <section className="card">
            <h2 className="card__title">По дням</h2>
            <p className="card__note">Подано и исполнено за две недели, {clock}</p>
            {/*
              Столбики, а не таблица: две недели по два числа читаются
              одним взглядом, а таблица на четырнадцать строк — нет.
              Высоты — от самого высокого дня; день без заявок остаётся
              на своём месте пустым, а не пропадает.
            */}
            <div className="bars" role="img" aria-label="Подано и исполнено по дням за две недели">
              {stats.byDay.map((day) => (
                <div key={day.day} className="bars__day" title={dayTitle(day)}>
                  <div className="bars__pair">
                    <span
                      className={day.submitted ? 'bars__bar' : 'bars__bar bars__bar--none'}
                      style={{ height: `${Math.round((day.submitted / maxDay) * 100)}%` }}
                    />
                    <span
                      className={
                        day.completed ? 'bars__bar bars__bar--done' : 'bars__bar bars__bar--none'
                      }
                      style={{ height: `${Math.round((day.completed / maxDay) * 100)}%` }}
                    />
                  </div>
                  <span className="bars__label">{day.day.slice(8, 10)}</span>
                </div>
              ))}
            </div>
            <p className="bars__legend">
              <span className="bars__key" /> подано <span className="bars__key bars__key--done" />{' '}
              исполнено
            </p>
          </section>
        </div>
      </section>

      {/*
        Состояние интеграции одной строкой: сколько ключей действует,
        отвечают ли точки, где документация. Подробности — в своих
        разделах; здесь ответ на «всё ли живо», не открывая их.
      */}
      {ownsIntegration ? (
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Интеграция</h2>
          <span className="section__rule" />
          <Link className="btn btn--soft btn--tiny" href="/docs">
            Документация
          </Link>
        </div>
        <p className="today">
          <span>
            ключей действует <b>{liveKeys}</b>
          </span>
          <span>
            точек вебхуков <b>{hooks.length}</b>
          </span>
          {failingHooks.length > 0 ? (
            <span>
              не отвечает <b>{failingHooks.length}</b> —{' '}
              <Link href="/webhooks">
                {WEBHOOK_ENDPOINT_STATE_LABELS.failing.toLowerCase()}, посмотреть
              </Link>
            </span>
          ) : hooks.length > 0 ? (
            <span className="today__note">все точки отвечают</span>
          ) : undefined}
          {liveKeys === 0 ? (
            <span className="today__note">
              по API заявки не подаются — <Link href="/keys">выпустить ключ</Link>
            </span>
          ) : undefined}
        </p>
      </section>
      ) : undefined}

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Последние заявки</h2>
          <span className="section__rule" />
          <Link className="btn btn--soft btn--tiny" href="/requests">
            Все заявки
          </Link>
        </div>

        {recent.length === 0 ? (
          <EmptyState
            icon="exchange"
            title="Заявок пока нет"
            text="Поданные заявки встанут сюда — и из кабинета, и по API."
          />
        ) : (
          <ul className="rows">
            {recent.map((request) => (
              <li key={request.id} className="row">
                <Link className="row__main" href={`/requests/${request.id}`}>
                  <span className="row__title">
                    {formatMoney(request.fromAmount, request.fromCode)} →{' '}
                    {request.toAmount
                      ? formatMoney(request.toAmount, request.toCode)
                      : request.toCode}
                  </span>
                  <span className="row__meta">
                    {request.reference ? `${request.reference} · ` : ''}
                    подана <Moment at={request.createdAt.toISOString()} />
                  </span>
                </Link>
                <span className={`pill pill--${STATUS_TONES[request.status]}`}>
                  {STATUS_LABELS[request.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function dayTitle(day: { day: string; submitted: number; completed: number }): string {
  return `${day.day}: подано ${day.submitted}, исполнено ${day.completed}`;
}
