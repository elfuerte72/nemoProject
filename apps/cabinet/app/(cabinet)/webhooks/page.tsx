import Link from 'next/link';
import { WEBHOOK_DELIVERY_STATUS_LABELS, WEBHOOK_EVENT_LABELS } from '@nemo/types';
import { HowTo, Moment, QuietRefresh } from '@nemo/ui';
import { allowedHere } from '@/lib/access';
import { getCore } from '@/lib/core';
import { WEBHOOKS_HOW_TO } from '@/lib/integration-texts';
import { viewer } from '@/lib/reads';
import { DELIVERY_STATUS_TONES, toDeliveryRow, toEndpointRow } from '@/lib/webhook-rows';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';
import { Endpoints } from './endpoints';

export const dynamic = 'force-dynamic';

/**
 * Вебхуки: куда сервис сообщает о переходах заявок мерчанта.
 *
 * Точки с событиями и состоянием, пробная доставка с ответом
 * приёмника, последние доставки — по ним мерчант чинит приёмник, не
 * спрашивая поддержку, чем тот подавился. Тихое обновление подтягивает
 * исходы: доставки идут воркером в фоне.
 */

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await allowedHere('/webhooks');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { actor, session } = await viewer();
  const core = getCore();
  const params = await searchParams;
  const raw = params.endpoint;
  const wanted = (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined;

  const endpoints = await core.listWebhookEndpoints(actor);
  // История одной точки — только своей: чужой идентификатор в адресе
  // молча читается как «все».
  const chosen = endpoints.find((one) => one.id === wanted);
  const deliveries = await core.listWebhookDeliveries(actor, {
    limit: 30,
    ...(chosen ? { endpointId: chosen.id } : {}),
  });

  return (
    <main className="page page--wide">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Вебхуки</h1>
          <p className="page__sub">Куда сообщать о переходах ваших заявок.</p>
        </div>
        <Link className="btn btn--ghost" href="/webhooks/guide">
          Как встроить
        </Link>
      </header>

      <HowTo
        title="Как устроено"
        sub="Точки, их состояния, пробная доставка и журнал"
        items={WEBHOOKS_HOW_TO}
      />

      <Endpoints endpoints={endpoints.map(toEndpointRow)} canAdd={session.status === 'active'} />

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {chosen ? `Доставки точки ${chosen.url}` : 'Последние доставки'}
          </h2>
          {chosen ? (
            <Link className="section__action" href="/webhooks">
              Все доставки
            </Link>
          ) : undefined}
          <span className="section__rule" />
        </div>
        {deliveries.length === 0 ? (
          <p className="note">Доставок пока не было: первая появится после события или пробной.</p>
        ) : (
          <ul className="table table--deliveries">
            <li className="table__head" aria-hidden>
              <span>Когда</span>
              <span>Событие</span>
              <span>Куда</span>
              <span>Попытка</span>
              <span>Состояние</span>
              <span>Ответ приёмника</span>
            </li>
            {deliveries.map(toDeliveryRow).map((delivery) => (
              <li key={delivery.id} className="table__item">
                <div className="table__row">
                  <span className="cell">
                    <span className="cell__label">Когда</span>
                    <span className="cell__value">
                      <Moment at={delivery.createdAt} />
                    </span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Событие</span>
                    <span className="cell__value">
                      <span className="mono">{delivery.event}</span>
                      <span className="muted"> · {WEBHOOK_EVENT_LABELS[delivery.event]}</span>
                    </span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Куда</span>
                    <span className="cell__value hook__url mono">{delivery.endpointUrl}</span>
                  </span>
                  <span className="cell cell--num">
                    <span className="cell__label">Попытка</span>
                    <span className="cell__value">
                      {delivery.attempt}
                      {delivery.status === 'pending' && delivery.attempt > 0 ? (
                        <span className="muted">
                          {' '}
                          · снова <Moment at={delivery.nextAttemptAt} />
                        </span>
                      ) : undefined}
                    </span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Состояние</span>
                    <span className={`pill pill--${DELIVERY_STATUS_TONES[delivery.status]}`}>
                      {WEBHOOK_DELIVERY_STATUS_LABELS[delivery.status]}
                    </span>
                  </span>
                  <span className="cell">
                    <span className="cell__label">Ответ приёмника</span>
                    <span className="cell__value hook__reply">
                      {delivery.responseStatus !== null ? (
                        <span className="mono">{delivery.responseStatus} </span>
                      ) : undefined}
                      {delivery.error}
                      {delivery.durationMs !== null ? (
                        <span className="muted"> · {delivery.durationMs} мс</span>
                      ) : undefined}
                      {/* Ждущая своей попытки доставка ответа ещё не получала. */}
                      {delivery.responseStatus === null && delivery.error === null ? (
                        <span className="muted">—</span>
                      ) : undefined}
                      {/*
                       * Тело ответа стоит рядом со словами отказа, а не
                       * вместо них: «Ответ 500» говорит, что сервер
                       * мерчанта отказал, а чем он подавился, написано
                       * только в теле.
                       */}
                      {delivery.responseBody ? (
                        <span className="hook__body mono" title={delivery.responseBody}>
                          {delivery.responseBody}
                        </span>
                      ) : undefined}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
