import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { formatAmount } from '@/lib/format';
import { bpsToPercent } from '@/lib/percent';
import { PERIOD_LABELS, TZ_COOKIE, dayOf, readTzOffset, resolvePeriod } from '@/lib/period';
import { HowTo } from '@/app/ui/howto';
import { Moment } from '@/app/ui/moment';
import { Stat, Stats } from '@/app/ui/stat';
import { PeriodChips } from '../analytics/period-chips';

export const dynamic = 'force-dynamic';

/**
 * Реферальная сводка одной страницей — администратору.
 *
 * Ставки лежат в настройках, начисления — на счетах клиентов, выводы —
 * в очереди. Здесь они рядом: сколько отдали рефералам за период по
 * линиям, сколько выплатили, сколько ждёт выплаты, и кто привёл больше
 * всех. Баллы — одна величина с доходом сервиса (docs/adr/0003), без
 * валюты.
 */

const HOW_TO = [
  {
    title: 'Две линии',
    detail:
      'Первая — кто привёл клиента, вторая — кто привёл приведшего. Каждой начисляется свой ' +
      'процент от дохода сервиса по заявке реферала; глубже второй линии баллы не идут.',
  },
  {
    title: 'Когда начисляется',
    detail:
      'В момент исполнения заявки, от суммы, которую менеджер назвал доходом. В период сводки ' +
      'начисление попадает по этому моменту, а не по подаче заявки.',
  },
  {
    title: 'Ставка в строке',
    detail:
      'Смена ставок прошлое не переписывает: у каждого начисления записана ставка, по ' +
      'которой оно посчитано. Здесь показаны текущие ставки — из настроек.',
  },
  {
    title: 'Выплаты',
    detail:
      'Баллы списываются отметкой о выплате в разделе «Вывод». «Ждёт выплаты» — сумма ' +
      'открытых заявок; «выплачено» — списанное за период.',
  },
];

export default async function ReferralPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const params = await searchParams;
  const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
  const period = resolvePeriod(
    { period: single(params.period), from: single(params.from), to: single(params.to) },
    new Date(),
    offset,
  );

  try {
    const core = getCore();
    const [summary, settings] = await Promise.all([
      core.summarizeReferrals(actor, period),
      core.getServiceSettings(actor),
    ]);
    const lastDay = new Date(period.to.getTime() - 1);
    const [line1, line2] = summary.accrued;

    return (
      <main className="page page--wide">
        <header className="page__head">
          <div>
            <h1 className="page__title">Рефералка</h1>
            <p className="page__sub">
              {PERIOD_LABELS[period.key]}: <Moment at={period.from.toISOString()} mode="day" /> —{' '}
              <Moment at={lastDay.toISOString()} mode="day" />
            </p>
          </div>
          <div className="page__actions">
            <Link href="/settings" className="btn btn--ghost">
              Изменить ставки в настройках
            </Link>
          </div>
        </header>

        <HowTo
          title="Как работает реферальная сеть"
          sub="Линии, начисления, выплаты"
          items={HOW_TO}
        />

        <Stats>
          <Stat
            label="Первая линия"
            value={`${bpsToPercent(settings.referralLine1Bps)} %`}
            note="от дохода сервиса по заявке реферала"
          />
          <Stat
            label="Вторая линия"
            value={`${bpsToPercent(settings.referralLine2Bps)} %`}
            note="от дохода по заявке реферала реферала"
          />
          <Stat
            label="Минимум на вывод"
            value={formatAmount(settings.minWithdrawalAmount)}
            note="баллов за одну заявку"
          />
          <Stat
            label="Кто-то кого-то привёл"
            value={summary.referrers}
            note="клиентов с хотя бы одним приведённым"
          />
        </Stats>

        <PeriodChips
          current={period.key}
          from={dayOf(period.from, offset)}
          to={dayOf(lastDay, offset)}
          basePath="/referral"
        />

        <Stats>
          <Stat
            label="Начислено · 1 линия"
            value={formatAmount(line1?.amount ?? '0')}
            note={`${line1?.count ?? 0} начислений за период`}
            tone={line1?.count ? 'up' : 'plain'}
          />
          <Stat
            label="Начислено · 2 линия"
            value={formatAmount(line2?.amount ?? '0')}
            note={`${line2?.count ?? 0} начислений за период`}
            tone={line2?.count ? 'up' : 'plain'}
          />
          <Stat label="Выплачено" value={formatAmount(summary.paid)} note="списано за период" />
          <Stat
            label="Ждёт выплаты"
            value={formatAmount(summary.pending)}
            note="открытые заявки на вывод — сейчас"
            tone={summary.pending !== '0' ? 'wait' : 'plain'}
            href="/withdrawals"
          />
        </Stats>

        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Кому начислили за период</h2>
              <p className="card__note">По сумме, первые двадцать</p>
            </div>
          </div>
          {summary.top.length ? (
            <div className="scroll-x">
              <table className="datatable">
                <thead>
                  <tr>
                    <th>Клиент</th>
                    <th className="num">Начислений</th>
                    <th className="num">Баллов</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.top.map((row) => (
                    <tr key={row.telegramUserId.toString()}>
                      <td>
                        <Link
                          href={`/clients/${row.telegramUserId.toString()}`}
                          className="who__link"
                        >
                          {row.username ? `@${row.username}` : row.telegramUserId.toString()}
                        </Link>
                      </td>
                      <td className="num">{row.accruals}</td>
                      <td className="num">{formatAmount(row.accrued)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">За период начислений не было.</p>
          )}
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof CoreError && error.code === 'forbidden') {
      return (
        <main className="page">
          <h1 className="page__title">Рефералка</h1>
          <p className="empty">
            Раздел доступен только администратору: здесь ставки и начисления сервиса.
          </p>
        </main>
      );
    }
    throw error;
  }
}

function single(value: string | string[] | undefined): string | undefined {
  const one = Array.isArray(value) ? value[0] : value;
  return one?.trim() || undefined;
}
