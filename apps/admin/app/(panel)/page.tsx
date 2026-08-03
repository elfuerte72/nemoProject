import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ManagerExchangeRequestView } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/exchange-request-labels';
import { formatAmount } from '@/lib/format';
import { pillClass } from '@/lib/labels';
import { Moment } from '@/app/ui/moment';

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
    <main className="page page--wide">
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
    <>
      <div className="table__head table--exchange">
        <span>Обмен</span>
        <span>Вид</span>
        <span>Клиент</span>
        <span>Состояние</span>
        <span>Подана</span>
      </div>
      <ul className="table table--exchange">
        {requests.map((request) => (
          <li
            key={request.id}
            className={
              STATUS_TONES[request.status] === 'wait'
                ? 'table__item table__item--fresh'
                : 'table__item table__item--settled'
            }
          >
            {/*
              Ссылка — вся строка, а не сумма в ней: попадать курсором в
              четыре слова текста тридцать раз подряд менеджеру незачем.
            */}
            <Link href={`/exchange-requests/${request.id}`} className="table__row">
              <span className="cell cell--num" data-label="Обмен">
                <span className="cell__value">
                  {formatAmount(request.fromAmount)} {request.fromCode} → {request.toCode}
                </span>
              </span>
              <span className="cell" data-label="Вид">
                <span className="cell__note">{KIND_LABELS[request.kind]}</span>
              </span>
              <span className="cell" data-label="Клиент">
                <span className="cell__note">{request.clientId.toString()}</span>
              </span>
              <span className="cell" data-label="Состояние">
                <span className={pillClass(STATUS_TONES[request.status])}>
                  {STATUS_LABELS[request.status]}
                </span>
              </span>
              <span className="cell cell--num" data-label="Подана">
                <span className="cell__note">
                  <Moment at={request.createdAt.toISOString()} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
