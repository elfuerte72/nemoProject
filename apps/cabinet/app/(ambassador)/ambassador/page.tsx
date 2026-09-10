import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { firstParam, HowTo, Moment, MoneyCompare, PeriodChips, Stat, Stats } from '@nemo/ui';
import { formatAmount } from '@nemo/ui/format';
import {
  PERIOD_LABELS,
  TZ_COOKIE,
  dayOf,
  readTzOffset,
  resolvePeriod,
  type PeriodKey,
} from '@nemo/ui/period';
import { AMBASSADOR_OVERVIEW_HOW_TO } from '@/lib/ambassador-texts';
import { ambassadorAccount, ambassadorPage, ambassadorStats } from '@/lib/ambassador-reads';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Обзор — кабинет амбассадора' };

/**
 * Обзор: сколько заработано всего, сколько можно забрать сейчас и что
 * произошло за период.
 *
 * Периоды те, что назвал владелец: пятнадцать, тридцать, сорок пять,
 * девяносто и сто восемьдесят дней. Каждое число сравнивается с равным
 * отрезком прямо перед выбранным, и считает всё сервер — по тем же
 * правилам, по которым панель считает свою аналитику (docs/adr/0013).
 *
 * Числа не подписаны валютой: балл сегодня безвалютный, и знак доллара
 * рядом с ним был бы обещанием, которого сервис не давал.
 */
const QUICK: readonly PeriodKey[] = ['15d', '30d', '45d', '90d', '180d'];

export default async function AmbassadorOverview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ambassadorPage();
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

  const [stats, account] = await Promise.all([
    ambassadorStats(period.from.getTime(), period.to.getTime(), offset),
    ambassadorAccount(),
  ]);
  const { current, previous } = stats;
  const lastDay = new Date(period.to.getTime() - 1);
  const clock = offset === 0 ? 'по UTC' : 'по вашим часам';
  const brought = account.lines.reduce((total, line) => total + line.count, 0);
  /*
   * Своя шкала каждому ряду: слева люди, справа баллы, и общий
   * максимум прижал бы двоих пришедших к нулю рядом с тысячей
   * начисленных. Столбики сравнивают день с днём внутри своего ряда, а
   * не человека с баллом.
   */
  const maxJoined = Math.max(1, ...stats.byDay.map((day) => day.joined));
  const maxAccrued = Math.max(1, ...stats.byDay.map((day) => Number(day.accrued)));

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Обзор</h1>
          <p className="page__sub">
            {brought > 0
              ? `У вас ${brought} приведённых по оплачиваемым линиям — здесь видно, что они принесли.`
              : 'По вашей ссылке пока никто не пришёл. Сама ссылка — в разделе «Ссылка».'}
          </p>
        </div>
      </header>

      <HowTo
        title="Как устроена программа"
        sub="За что платят и когда меняются числа"
        items={AMBASSADOR_OVERVIEW_HOW_TO}
      />

      <Stats>
        <Stat
          label="Заработано всего"
          value={formatAmount(account.earned)}
          note="начислено за всё время программы"
        />
        <Stat
          label="Остаток к выводу"
          value={formatAmount(account.balance)}
          note={`минимум на заявку — ${formatAmount(account.minWithdrawalAmount)}`}
          tone={account.balance !== '0' ? 'up' : 'plain'}
          href="/ambassador/withdrawal"
        />
        <Stat
          label="Ждёт выплаты"
          value={formatAmount(stats.pending)}
          note="в поданных заявках на вывод"
          tone={stats.pending !== '0' ? 'wait' : 'plain'}
          href="/ambassador/withdrawal"
        />
      </Stats>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {PERIOD_LABELS[period.key]}: <Moment at={period.from.toISOString()} mode="day" /> —{' '}
            <Moment at={lastDay.toISOString()} mode="day" />
          </h2>
          <span className="section__rule" />
        </div>

        <PeriodChips
          current={period.key}
          basePath="/ambassador"
          quick={QUICK}
          from={dayOf(period.from, offset)}
          to={dayOf(lastDay, offset)}
        />

        <Stats>
          <Stat
            label="Пришли"
            value={current.joined}
            note={
              current.joinedByLine.length
                ? current.joinedByLine.map((line) => `${line.line} линия: ${line.count}`).join(' · ')
                : `было ${previous.joined}`
            }
            tone={current.joined > previous.joined ? 'up' : 'plain'}
            href="/ambassador/people"
          />
          <Stat
            label="Стали активными"
            value={current.activated}
            note={`первая исполненная заявка · было ${previous.activated}`}
            tone={current.activated > previous.activated ? 'up' : 'plain'}
          />
          <Stat
            label="Начислено"
            value={formatAmount(current.accrued)}
            note={`было ${formatAmount(previous.accrued)}`}
          />
          <Stat
            label="Выплачено"
            value={formatAmount(current.paid)}
            note={`было ${formatAmount(previous.paid)}`}
          />
        </Stats>

        <div className="grid">
          <section className="card">
            <h2 className="card__title">Оборот приведённых</h2>
            <p className="card__note">
              Отдано по их исполненным заявкам — по каждой валюте отдельно
            </p>
            <MoneyCompare now={current.turnover} before={previous.turnover} />
          </section>

          <section className="card">
            <h2 className="card__title">По дням</h2>
            <p className="card__note">
              Пришли и начислено за две недели, {clock}. У каждого ряда своя высота: люди и баллы
              меряются разным
            </p>
            {/*
              Столбики те же, что в обзоре мерчанта: две недели по два
              числа читаются одним взглядом, а таблица на четырнадцать
              строк — нет. День без событий остаётся пустым на своём
              месте, а не пропадает.
            */}
            <div className="bars" role="img" aria-label="Пришли и начислено по дням за две недели">
              {stats.byDay.map((day) => (
                <div
                  key={day.day}
                  className="bars__day"
                  title={`${day.day}: пришли ${day.joined}, начислено ${formatAmount(day.accrued)}`}
                >
                  <div className="bars__pair">
                    <span
                      className={day.joined ? 'bars__bar' : 'bars__bar bars__bar--none'}
                      style={{ height: `${Math.round((day.joined / maxJoined) * 100)}%` }}
                    />
                    <span
                      className={
                        day.accrued !== '0'
                          ? 'bars__bar bars__bar--done'
                          : 'bars__bar bars__bar--none'
                      }
                      style={{ height: `${Math.round((Number(day.accrued) / maxAccrued) * 100)}%` }}
                    />
                  </div>
                  <span className="bars__label">{day.day.slice(8, 10)}</span>
                </div>
              ))}
            </div>
            <p className="bars__legend">
              <span className="bars__key" /> пришли <span className="bars__key bars__key--done" />{' '}
              начислено
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
