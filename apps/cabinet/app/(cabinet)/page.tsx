import Link from 'next/link';
import { EmptyState, Greeting, HowTo, Moment, QuietRefresh } from '@nemo/ui';
import { formatMoney } from '@nemo/ui/format';
import { getCore } from '@/lib/core';
import { STATUS_LABELS, STATUS_TONES } from '@/lib/labels';
import { openCount, requestCounts, viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';

export const dynamic = 'force-dynamic';

/**
 * Обзор: что происходит прямо сейчас.
 *
 * Отвечает на первый вопрос, с которым открывают кабинет, — «что с
 * моими заявками», — и потому показывает последние из них, а не числа
 * за период: числа приходят с тикетом 09, а заявки нужны с первого дня.
 */

const HOW_TO = [
  {
    title: 'Как устроен обмен',
    detail:
      'Вы подаёте заявку по курсу, который видели, — курс держится до конца срока оплаты. ' +
      'Менеджер выдаёт реквизиты, вы платите, мы отправляем деньги получателю.',
  },
  {
    title: 'Курс — обязательство',
    detail:
      'Названный при подаче курс не меняется ни нами, ни менеджером. Если источник ' +
      'котировки молчал, курс назовёт менеджер — до того, как вы заплатите.',
  },
  {
    title: 'Пока заявку не взяли',
    detail:
      'Её можно отменить самому. Дальше отменяет менеджер: с этого момента по заявке уже ' +
      'могли уйти деньги.',
  },
];

export default async function OverviewPage() {
  const { actor, session } = await viewer();

  const [recent, counts] = await Promise.all([
    getCore().listExchangeRequests(actor, { limit: 5 }),
    requestCounts(),
  ]);
  const active = openCount(counts);

  return (
    <main className="page">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

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

      <HowTo title="Как это устроено" sub="Что происходит с заявкой и когда" items={HOW_TO} />

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
