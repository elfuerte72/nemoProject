'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  WEBHOOK_DELIVERY_STATUS_LABELS,
  WEBHOOK_ENDPOINT_STATE_LABELS,
  WEBHOOK_EVENT_LABELS,
  type WebhookEvent,
} from '@nemo/types';
import { CopyValue, EmptyState, Moment } from '@nemo/ui';
import { SUBSCRIBABLE_EVENTS, type DeliveryRow, type EndpointRow } from '@/lib/webhook-rows';
import { send } from '@/app/ui/send';

/**
 * Точки: список с действиями и заведение новой.
 *
 * Секрет новой точки показывается тут же и пропадает с первой
 * перерисовкой: второго показа нет. Пробная доставка отвечает на месте
 * — ответом приёмника, а не «отправлено». Удаление спрашивает
 * подтверждение раскрытием строки: необратимое.
 */

/** Цвет состояния — тем же правилом, что у пилюль заявок: золото зовёт человека. */
const STATE_TONES = { active: 'done', paused: 'wait', failing: 'off' } as const;

export function Endpoints({
  endpoints,
  canAdd,
}: {
  readonly endpoints: readonly EndpointRow[];
  /** Ложь у отключённого: заведение отказало бы, пауза и удаление — нет. */
  readonly canAdd: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string>();
  const [complaint, setComplaint] = useState<string>();
  const [added, setAdded] = useState<{ url: string; secret: string }>();
  const [pings, setPings] = useState<Record<string, DeliveryRow>>({});
  const [removing, setRemoving] = useState<string>();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<readonly WebhookEvent[]>(SUBSCRIBABLE_EVENTS);

  async function act(key: string, path: string, body: unknown, after: (data: unknown) => void) {
    setBusy(key);
    setComplaint(undefined);
    const result = await send(path, body);
    setBusy(undefined);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    after(result.data);
    router.refresh();
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    await act('add', '/api/webhooks', { url, events }, (data) => {
      const { endpoint, secret } = data as { endpoint: EndpointRow; secret: string };
      setAdded({ url: endpoint.url, secret });
      setUrl('');
    });
  }

  return (
    <section className="card">
      <h2 className="card__title">Точки</h2>

      {added ? (
        <div className="secret" role="status">
          <p className="secret__title">
            Точка {added.url} заведена. Скопируйте секрет сейчас — второй раз он не покажется.
          </p>
          <CopyValue value={added.secret} />
          <p className="secret__note">
            Им приёмник проверяет подпись x-webhook-signature. Потеряли — удалите точку и
            заведите заново.
          </p>
        </div>
      ) : undefined}

      {complaint ? <p className="error">{complaint}</p> : undefined}

      {endpoints.length === 0 ? (
        <EmptyState
          icon="plug"
          title="Точек пока нет"
          text="Заведите адрес приёмника — и отметьте, о каких переходах заявок сообщать."
        />
      ) : (
        <ul className="rows">
          {endpoints.map((endpoint) => {
            const ping = pings[endpoint.id];
            return (
              <li key={endpoint.id} className="row row--stack hook">
                <div className="row__main">
                  <span className="row__title hook__url mono">{endpoint.url}</span>
                  <span className="row__meta">
                    {endpoint.events.map((one) => (
                      <span key={one} className="tag">
                        {WEBHOOK_EVENT_LABELS[one]}
                      </span>
                    ))}
                  </span>
                  <span className="row__meta">
                    {endpoint.deliveries === 0
                      ? 'доставок не было'
                      : `доставок: ${endpoint.deliveries}`}
                    {endpoint.lastDelivery ? (
                      <>
                        {' · последняя '}
                        <Moment at={endpoint.lastDelivery.at} />
                        {` — ${WEBHOOK_DELIVERY_STATUS_LABELS[endpoint.lastDelivery.status].toLowerCase()}`}
                      </>
                    ) : undefined}
                  </span>
                  {ping ? (
                    <span className="row__meta hook__ping" role="status">
                      Пробная: {WEBHOOK_DELIVERY_STATUS_LABELS[ping.status].toLowerCase()}
                      {ping.responseStatus !== null ? `, ответ ${ping.responseStatus}` : ''}
                      {ping.error ? ` — ${ping.error}` : ''}
                      {ping.durationMs !== null ? ` (${ping.durationMs} мс)` : ''}
                      {ping.status === 'pending' ? ' — исход придёт с обновлением' : ''}
                    </span>
                  ) : undefined}
                </div>
                <div className="row__side">
                  <span
                    className={`pill pill--${STATE_TONES[endpoint.state]}`}
                    title={endpoint.state === 'failing' ? 'Пять попыток подряд провалились' : undefined}
                  >
                    {WEBHOOK_ENDPOINT_STATE_LABELS[endpoint.state]}
                  </span>
                </div>
                <div className="row__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--tiny"
                    aria-busy={busy === `ping:${endpoint.id}`}
                    onClick={() =>
                      void act(`ping:${endpoint.id}`, `/api/webhooks/${endpoint.id}/ping`, {}, (data) => {
                        const { delivery } = data as { delivery: DeliveryRow };
                        setPings((current) => ({ ...current, [endpoint.id]: delivery }));
                      })
                    }
                  >
                    {busy === `ping:${endpoint.id}` ? 'Шлём…' : 'Пробное'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--tiny"
                    aria-busy={busy === `pause:${endpoint.id}`}
                    onClick={() =>
                      void act(
                        `pause:${endpoint.id}`,
                        `/api/webhooks/${endpoint.id}/pause`,
                        { paused: endpoint.pausedAt === null },
                        () => undefined,
                      )
                    }
                  >
                    {endpoint.pausedAt ? 'Включить' : 'Пауза'}
                  </button>
                  <Link className="btn btn--ghost btn--tiny" href={`/webhooks?endpoint=${endpoint.id}`}>
                    История
                  </Link>
                  {removing === endpoint.id ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--danger btn--tiny"
                        aria-busy={busy === `remove:${endpoint.id}`}
                        onClick={() =>
                          void act(
                            `remove:${endpoint.id}`,
                            `/api/webhooks/${endpoint.id}/remove`,
                            {},
                            () => setRemoving(undefined),
                          )
                        }
                      >
                        Да, удалить
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--tiny"
                        onClick={() => setRemoving(undefined)}
                      >
                        Оставить
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost btn--tiny"
                      onClick={() => setRemoving(endpoint.id)}
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canAdd ? (
        <form className="hook__form" onSubmit={add}>
          <label className="field">
            <span className="label">Адрес приёмника</span>
            <input
              className="input"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://shop.example/hooks/tobee"
              required
            />
            <span className="cell__note">Только https на публичный хост. Проверить доставку — кнопкой «Пробное».</span>
          </label>
          <div className="field">
            <span className="label">События</span>
            <div className="hook__events">
              {SUBSCRIBABLE_EVENTS.map((one) => (
                <label key={one} className="check">
                  <input
                    type="checkbox"
                    checked={events.includes(one)}
                    onChange={(event) =>
                      setEvents((current) =>
                        event.target.checked
                          ? [...current, one]
                          : current.filter((known) => known !== one),
                      )
                    }
                  />
                  {WEBHOOK_EVENT_LABELS[one]} <span className="muted mono">{one}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="row__actions">
            <button type="submit" className="btn btn--gold" disabled={busy === 'add'}>
              {busy === 'add' ? 'Заводим…' : 'Завести точку'}
            </button>
          </div>
        </form>
      ) : (
        <p className="card__note">Доступ отключён: новые точки не заводятся, пауза и удаление работают.</p>
      )}
    </section>
  );
}
