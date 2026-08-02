import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ManagerExchangeRequestView } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/exchange-request-labels';
import { formatAmount } from '@/lib/format';
import { pillClass } from '@/lib/labels';

export const dynamic = 'force-dynamic';

/**
 * Рабочий стол менеджера: очередь и то, что уже в работе.
 *
 * Очередь общая и видна всем — так менеджеры понимают объём работы. Кто
 * какую заявку ведёт, видно из второго списка: параллельная работа над
 * одной заявкой — это два звонка клиенту и два разных курса.
 */
export default async function DeskPage() {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const core = getCore();
  const [queue, inProgress] = await Promise.all([
    core.listExchangeRequestQueue(actor),
    core.listExchangeRequestsInProgress(actor),
  ]);

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Заявки на обмен</h1>
          <p className="page__sub">Очередь общая: заявку ведёт тот, кто взял её первым.</p>
        </div>
      </header>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Очередь</h2>
          <span className="section__count">{queue.length}</span>
          <span className="section__rule" />
        </div>
        <ExchangeRequestList requests={queue} empty="Новых заявок нет." />
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">В работе</h2>
          <span className="section__count">{inProgress.length}</span>
          <span className="section__rule" />
        </div>
        <ExchangeRequestList requests={inProgress} empty="Ничего не в работе." />
      </section>
    </main>
  );
}

function ExchangeRequestList({
  requests,
  empty,
}: {
  requests: readonly ManagerExchangeRequestView[];
  empty: string;
}) {
  if (requests.length === 0) {
    return <p className="empty">{empty}</p>;
  }

  return (
    <ul className="rows">
      {requests.map((request) => (
        <li key={request.id}>
          {/*
            Ссылка — вся строка, а не сумма в ней: попадать курсором в
            четыре слова текста тридцать раз подряд менеджеру незачем.
          */}
          <Link href={`/exchange-requests/${request.id}`} className="row">
            <div className="row__main">
              <span className="row__title">
                {formatAmount(request.fromAmount)} {request.fromCode} → {request.toCode}
              </span>
              <span className="row__meta">
                {KIND_LABELS[request.kind]} · клиент {request.clientId.toString()}
              </span>
            </div>
            <div className="row__side">
              <span className={pillClass(STATUS_TONES[request.status])}>
                {STATUS_LABELS[request.status]}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
