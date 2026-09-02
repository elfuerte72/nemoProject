import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/exchange-request-labels';
import { formatAmount } from '@/lib/format';
import { pillClass } from '@/lib/labels';
import { formatByCurrency } from '@/lib/money-list';
import { ClientCard } from '@/app/ui/client-card';
import { Moment } from '@/app/ui/moment';
import { Stat, Stats } from '@/app/ui/stat';

export const dynamic = 'force-dynamic';

/**
 * Карточка клиента: кто это, сколько с ним работали, все его заявки.
 *
 * Врезка клиента — та же, что в заявке и переписке: вопрос «с кем имею
 * дело» один и тот же. Заявки — новые сверху, с именем ведущего; строка
 * ведёт в карточку заявки.
 */
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    notFound();
  }
  const clientId = BigInt(id);
  const core = getCore();

  const card = await core.getClientCard(actor, clientId).catch((error: unknown) => {
    if (error instanceof CoreError && error.code === 'not-found') return null;
    throw error;
  });
  if (!card) {
    notFound();
  }

  const [rows, [summary]] = await Promise.all([
    core.listClientExchangeRequests(actor, clientId, { limit: 100 }),
    core.listClients(actor, { query: id, limit: 1 }),
  ]);

  const title = card.username ? `@${card.username}` : `Клиент ${id}`;

  return (
    <main className="page page--wide">
      <Link href="/clients" className="page__back">
        ← К клиентам
      </Link>
      <header className="page__head">
        <div>
          <h1 className="page__title">
            {title}
            {summary?.regular ? <span className="tag tag--gold"> постоянный</span> : undefined}
          </h1>
          <p className="page__sub">
            В сервисе с <Moment at={card.createdAt.toISOString()} mode="day" />
            {summary?.waiting ? ' · ждёт ответа в переписке' : ''}
          </p>
        </div>
        <div className="page__actions">
          <Link href={`/conversations/${id}`} className="btn btn--soft">
            Переписка
          </Link>
        </div>
      </header>

      <div className="split split--work">
        <div className="split__main">
          <Stats>
            <Stat label="Исполнено" value={summary?.completed ?? 0} note="заявок" />
            <Stat
              label="В работе"
              value={summary?.open ?? 0}
              note="сейчас"
              tone={summary?.open ? 'wait' : 'plain'}
            />
            <Stat label="Отменено" value={summary?.cancelled ?? 0} note="заявок" />
            <Stat
              label="Оборот"
              value={formatByCurrency(summary?.turnover ?? [])}
              note="отдано по исполненным, по валютам"
            />
          </Stats>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Заявки</h2>
              <span className="section__count">{rows.length}</span>
              <span className="section__rule" />
            </div>
            {rows.length === 0 ? (
              <p className="empty">Заявок у клиента ещё не было.</p>
            ) : (
              <>
                <div aria-hidden className="table__head table--client-requests">
                  <span>Обмен</span>
                  <span>Вид</span>
                  <span>Состояние</span>
                  <span>Ведёт</span>
                  <span>Подана</span>
                  <span>Доход</span>
                </div>
                <ul className="table table--client-requests">
                  {rows.map((request) => (
                    <li
                      key={request.id}
                      className={
                        STATUS_TONES[request.status] === 'wait'
                          ? 'table__item table__item--fresh'
                          : 'table__item table__item--settled'
                      }
                    >
                      <Link href={`/exchange-requests/${request.id}`} className="table__row">
                        <span className="cell cell--num">
                          <span className="cell__label">Обмен</span>
                          <span className="cell__value">
                            {formatAmount(request.fromAmount)} {request.fromCode} →{' '}
                            {request.toAmount ? `${formatAmount(request.toAmount)} ` : ''}
                            {request.toCode}
                          </span>
                        </span>
                        <span className="cell">
                          <span className="cell__label">Вид</span>
                          <span className="cell__note">{KIND_LABELS[request.kind]}</span>
                        </span>
                        <span className="cell">
                          <span className="cell__label">Состояние</span>
                          <span className={pillClass(STATUS_TONES[request.status])}>
                            {STATUS_LABELS[request.status]}
                          </span>
                        </span>
                        <span className="cell">
                          <span className="cell__label">Ведёт</span>
                          <span className="cell__note">{request.assignedManagerName ?? '—'}</span>
                        </span>
                        <span className="cell cell--num">
                          <span className="cell__label">Подана</span>
                          <span className="cell__note">
                            <Moment at={request.createdAt.toISOString()} />
                          </span>
                        </span>
                        <span className="cell cell--num">
                          <span className="cell__label">Доход</span>
                          <span className="cell__note">
                            {request.serviceIncome
                              ? `${formatAmount(request.serviceIncome)} ${request.serviceIncomeCode ?? ''}`
                              : '—'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {rows.length >= 100 ? (
                  <p className="table__foot">Показаны последние 100 заявок.</p>
                ) : undefined}
              </>
            )}
          </section>
        </div>

        <ClientCard
          clientId={id}
          conversationHref={`/conversations/${id}`}
          client={{
            ...card,
            telegramUserId: card.telegramUserId.toString(),
            referrerId: card.referrerId?.toString() ?? null,
            createdAt: card.createdAt.toISOString(),
          }}
        />
      </div>
    </main>
  );
}
