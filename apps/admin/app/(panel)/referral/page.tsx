import Link from 'next/link';
import { referralLineName, type ReferralLine } from '@nemo/types';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { formatAmount } from '@nemo/ui/format';
import { HowTo, Moment, PeriodChips, Stat, Stats } from '@nemo/ui';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { bpsToPercent } from '@/lib/percent';
import { PERIOD_LABELS, TZ_COOKIE, dayOf, readTzOffset, resolvePeriod } from '@nemo/ui/period';

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
    title: 'Линии',
    detail:
      'Первая — кто привёл клиента, вторая — кто привёл приведшего, и так до пятой. Сколько ' +
      'линий оплачивается и по какой ставке, задаёт администратор; каждой начисляется свой ' +
      'процент от дохода сервиса по заявке реферала. Поверх базовых ставок — уровни по числу ' +
      'активных рефералов и личные ставки клиента: личная выше уровня, уровень выше базовой.',
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
      'которой оно посчитано. Здесь показаны текущие базовые ставки программы.',
  },
  {
    title: 'Выплаты',
    detail:
      'Баллы списываются отметкой о выплате в разделе «Вывод». «Ждёт выплаты» — сумма ' +
      'открытых заявок; «выплачено» — списанное за период.',
  },
];

/** «Первая линия» — подпись плитки с заглавной. */
function lineTitle(line: ReferralLine): string {
  const name = referralLineName(line);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

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
    const [summary, program, settings] = await Promise.all([
      core.summarizeReferrals(actor, period),
      core.getReferralProgram(actor),
      core.getServiceSettings(actor),
    ]);
    const lastDay = new Date(period.to.getTime() - 1);

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
          {program.lines.map((line) => (
            <Stat
              key={line.line}
              label={`${lineTitle(line.line)} линия`}
              value={`${bpsToPercent(line.rateBps)} %`}
              note={
                line.line === 1
                  ? 'от дохода сервиса по заявке реферала'
                  : `базовая ставка; уровней — ${program.tiers.length}`
              }
            />
          ))}
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
          {summary.accrued.map((line) => (
            <Stat
              key={line.line}
              label={`Начислено · ${line.line} линия`}
              value={formatAmount(line.amount)}
              note={`${line.count} начислений за период`}
              tone={line.count ? 'up' : 'plain'}
            />
          ))}
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
