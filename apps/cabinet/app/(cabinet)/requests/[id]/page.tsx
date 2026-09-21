import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isCoreError } from '@nemo/http';
import { isUuid } from '@nemo/types';
import { CopyValue, Moment, QuietRefresh } from '@nemo/ui';
import { formatMoney, formatRate } from '@nemo/ui/format';
import { getCore } from '@/lib/core';
import { viewer } from '@/lib/reads';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/labels';
import { pathOf, paymentBlockOf, SUBMITTED_VIA } from '@/lib/request-card';
import { CancelRequest } from './cancel-request';
import { PaymentDeadlineLine } from './payment-deadline';

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
  const { actor } = await viewer();
  const { id } = await params;
  // Номер не того вида — «не найдена», как и чужая: база на него
  // отвечает не пустотой, а ошибкой.
  if (!isUuid(id)) notFound();
  const core = getCore();

  const request = await core.getExchangeRequest(actor, id).catch((error: unknown) => {
    // Чужая заявка — «не найдена», и отвечать на неё надо так же:
    // отличать одно от другого значило бы подтверждать её существование
    // тому, кто перебирает номера.
    // По коду, а не по классу: ядро заводит хук запуска в своём бандле,
    // и `instanceof` здесь ложно (`lib/core-errors.test.ts`).
    if (isCoreError(error) && error.code === 'not-found') notFound();
    throw error;
  });
  const [events, terms] = await Promise.all([
    core.listExchangeRequestEventsForOwner(actor, id),
    core.getExchangeTerms(),
  ]);

  const rate = request.finalRate ?? request.requestRate;
  const payment = paymentBlockOf(request);
  /*
   * Где отменённая оборвалась, говорит её история: последнее состояние
   * перед отменой. Лента идёт по времени, и берётся из неё последнее,
   * что отменой не было.
   */
  const reached = [...events].reverse().find((one) => one.toStatus !== 'cancelled')?.toStatus;
  const path = pathOf({ status: request.status, reached });

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
          {/*
            Заголовком — номер мерчанта: «заказ 1013» знают его система и
            его покупатель, а нашего номера он не видел нигде, кроме этой
            страницы. Нет своего — заголовком остаётся наш: у заявки,
            заведённой менеджером, своего может не быть.
          */}
          <h1 className="page__title">
            {request.reference ?? `Заявка ${request.id.slice(0, 8)}`}
          </h1>
          <p className="page__sub">
            {KIND_LABELS[request.kind]} · подана{' '}
            {request.source ? `${SUBMITTED_VIA[request.source]} · ` : ''}
            <Moment at={request.createdAt.toISOString()} />
          </p>
          {/*
            Наш номер — целиком и с копированием: по нему заявку называют
            в поддержке и по нему же ходит API. Обрезок из восьми знаков
            скопировать можно, а найти по нему нельзя.
          */}
          <p className="page__id">
            <span className="page__id-label">Номер в Tobee</span>
            <CopyValue value={request.id} />
          </p>
        </div>
        <div className="page__actions">
          <span className={`pill pill--${STATUS_TONES[request.status]}`}>
            {STATUS_LABELS[request.status]}
          </span>
        </div>
      </header>

      {/*
        Где заявка и кого она ждёт. Пилюля в углу отвечает только на
        первое; второе раньше лежало абзацем над списком заявок, а нужно
        оно здесь — про текущий шаг этой заявки.
      */}
      <section className="card" aria-label="Путь заявки">
        <ol className="path">
          {path.steps.map((step) => (
            <li
              key={step.label}
              className={`path__step path__step--${step.state}`}
              {...(step.state === 'current' ? { 'aria-current': 'step' as const } : {})}
            >
              <span className="path__mark" aria-hidden="true" />
              <span className="path__label">{step.label}</span>
            </li>
          ))}
        </ol>
        <p className={path.waitsForMerchant ? 'path__note path__note--wait' : 'path__note'}>
          {path.note}
        </p>
      </section>

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

      {/*
        Что сказать о реквизитах, решает состояние заявки, а не их
        наличие (`lib/request-card.ts`): есть они у заявки до самого
        конца, а платить по ним надо только пока она ждёт оплаты.
      */}
      {payment ? (
        <section className="card">
          <h2 className="card__title">{payment.title}</h2>
          <p className="card__note">{payment.note}</p>
          <p className={payment.kind === 'void' ? 'instructions instructions--void' : 'instructions'}>
            {request.paymentInstructions}
          </p>
          {payment.deadline && request.requisitesIssuedAt ? (
            <PaymentDeadlineLine
              issuedAt={request.requisitesIssuedAt.toISOString()}
              ttlMinutes={terms.unpaidTtlMinutes}
            />
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
