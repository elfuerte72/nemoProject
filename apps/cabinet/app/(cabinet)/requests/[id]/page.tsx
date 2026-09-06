import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { Moment, QuietRefresh } from '@nemo/ui';
import { formatMoney, formatRate } from '@nemo/ui/format';
import { requireViewer } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/labels';
import { CancelRequest } from './cancel-request';

export const dynamic = 'force-dynamic';

/**
 * Карточка заявки: чем она была, где она сейчас и что делать дальше.
 *
 * Реквизиты для оплаты стоят здесь, а не только в письме: письмо зовёт
 * в кабинет, потому что почтовый ящик сервису не принадлежит, а перевод
 * по подменённым реквизитам не возвращается. Здесь же — срок оплаты:
 * курс держится до его конца.
 */
export default async function RequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireViewer();
  const { id } = await params;
  const core = getCore();

  const request = await core.getExchangeRequest(actor, id).catch((error: unknown) => {
    // Чужая заявка — «не найдена», и отвечать на неё надо так же:
    // отличать одно от другого значило бы подтверждать её существование
    // тому, кто перебирает номера.
    if (error instanceof CoreError && error.code === 'not-found') notFound();
    throw error;
  });
  const [events, terms] = await Promise.all([
    core.listExchangeRequestEventsForOwner(actor, id),
    core.getExchangeTerms(),
  ]);

  const rate = request.finalRate ?? request.requestRate;

  return (
    <main className="page">
      <QuietRefresh />
      <header className="page__head">
        <div>
          <p className="page__eyebrow">
            <Link className="page__back" href="/requests">
              Заявки
            </Link>
          </p>
          <h1 className="page__title">Заявка {request.id.slice(0, 8)}</h1>
          <p className="page__sub">
            {KIND_LABELS[request.kind]}
            {request.reference ? ` · ваш номер: ${request.reference}` : ''} · подана{' '}
            <Moment at={request.createdAt.toISOString()} />
          </p>
        </div>
        <div className="page__actions">
          <span className={`pill pill--${STATUS_TONES[request.status]}`}>
            {STATUS_LABELS[request.status]}
          </span>
        </div>
      </header>

      <section className="card">
        <div className="deal">
          <span className="deal__side">
            <span className="deal__label">Отдаю</span>
            <span className="deal__amount">
              {formatMoney(request.fromAmount, request.fromCode)}
            </span>
          </span>
          <span className="deal__side">
            <span className="deal__label">Получаю</span>
            <span className="deal__amount">
              {request.toAmount
                ? formatMoney(request.toAmount, request.toCode)
                : `по курсу, ${request.toCode}`}
            </span>
          </span>
          <span className="deal__side">
            <span className="deal__label">Курс</span>
            <span className="deal__amount">
              {rate ? formatRate(rate, request.fromCode, request.toCode) : 'назовёт менеджер'}
            </span>
          </span>
        </div>
      </section>

      {request.paymentInstructions ? (
        <section className="card">
          <h2 className="card__title">Куда платить</h2>
          <p className="card__note">
            Проверьте получателя перед переводом: деньги, ушедшие по опечатке, не
            возвращаются.
          </p>
          <p className="instructions">{request.paymentInstructions}</p>
          {request.requisitesIssuedAt ? (
            <p className="muted">
              Реквизиты выданы <Moment at={request.requisitesIssuedAt.toISOString()} />. На
              оплату — {terms.unpaidTtlMinutes} мин с этого момента: столько держится
              курс. Неоплаченную заявку сервис отменит.
            </p>
          ) : undefined}
        </section>
      ) : undefined}

      {request.cancelReason ? (
        <section className="card">
          <h2 className="card__title">Почему отменена</h2>
          <p className="muted">{request.cancelReason}</p>
        </section>
      ) : undefined}

      <section className="card">
        <h2 className="card__title">Что происходило</h2>
        {events.length === 0 ? (
          <p className="muted">Пока ничего: заявка только подана.</p>
        ) : (
          <ul className="trail">
            {events.map((event) => (
              <li
                key={`${event.createdAt.toISOString()}-${event.toStatus}`}
                className="trail__item"
              >
                <span className="trail__when">
                  <Moment at={event.createdAt.toISOString()} />
                </span>
                <span>{STATUS_LABELS[event.toStatus]}</span>
                {event.comment ? <span className="muted">{event.comment}</span> : undefined}
              </li>
            ))}
          </ul>
        )}
      </section>

      {request.status === 'new' ? <CancelRequest id={request.id} /> : undefined}
    </main>
  );
}
