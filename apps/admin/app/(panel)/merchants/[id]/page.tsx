import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isCoreError } from '@nemo/http';
import {
  isUuid,
  WEBHOOK_DELIVERY_STATUS_LABELS,
  WEBHOOK_ENDPOINT_STATE_LABELS,
  WEBHOOK_EVENT_LABELS,
} from '@nemo/types';
import {
  EmptyState,
  ExchangeCountTiles,
  firstParam,
  IntegrationTiles,
  Moment,
  MoneyCompare,
  PeriodChips,
  Stats,
} from '@nemo/ui';
import { PERIOD_LABELS, TZ_COOKIE, dayOf, readTzOffset, resolvePeriod } from '@nemo/ui/period';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { toExchangeRow } from '@/lib/exchange-rows';
import { toMerchantCardData } from '@/lib/merchant-card';
import { MERCHANT_STATUS_LABELS, MerchantCard, merchantPillClass } from '@/app/ui/merchant-card';
import { MerchantActions } from './merchant-actions';

export const dynamic = 'force-dynamic';

/**
 * Карточка мерчанта: анкета, контакты, состояние и его заявки.
 *
 * Читают её обе роли — менеджер ведёт заявки мерчанта и должен знать, с
 * кем имеет дело, — а кнопки видит только администратор: одобрение
 * открывает право создавать обязательства сервиса по курсу. Скрытая
 * кнопка при этом не разграничение доступа, а его видимость: отказывает
 * сама операция, и маршрут отвечает менеджеру тем же отказом.
 *
 * Числа за период — той же операцией и по тем же правилам, что обзор
 * в кабинете мерчанта (docs/adr/0013): сотрудник и мерчант смотрят на
 * одни числа. Период живёт в адресе, «сегодня» — по часам сотрудника.
 */
export default async function MerchantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const { id } = await params;
  // Номер не того вида — «не найдено», а не ошибка базы.
  if (!isUuid(id)) {
    notFound();
  }
  const query = await searchParams;
  const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
  const now = new Date();
  const period = resolvePeriod(
    { period: firstParam(query.period), from: firstParam(query.from), to: firstParam(query.to) },
    now,
    offset,
  );
  const core = getCore();

  const merchant = await core.getMerchantCard(actor, id).catch((error: unknown) => {
    if (isCoreError(error) && error.code === 'not-found') {
      notFound();
    }
    throw error;
  });

  /*
   * Заявки мерчанта — той же выборкой, что и стол: набор колонок и
   * правила сужения у них одни. Показывается первая страница; за
   * остальными менеджер идёт в стол по ссылке — там курсор и «показать
   * ещё».
   */
  const [requests, keys, hooks, stats] = await Promise.all([
    core.listMerchantExchangeRequests(actor, id, { limit: 10 }),
    core.listMerchantApiKeys(actor, id),
    core.listMerchantWebhookEndpoints(actor, id),
    core.summarizeMerchant(actor, id, period, { offsetMinutes: offset, now }),
  ]);
  const { current, previous } = stats;
  const lastDay = new Date(period.to.getTime() - 1);

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">{merchant.name}</h1>
          <p className="page__sub">
            Анкета подана <Moment at={merchant.createdAt.toISOString()} mode="day" />
            {merchant.approvedAt ? (
              <>
                {' · одобрена '}
                <Moment at={merchant.approvedAt.toISOString()} mode="day" />
              </>
            ) : undefined}
          </p>
        </div>
        <span className={merchantPillClass(merchant.status)}>
          {MERCHANT_STATUS_LABELS[merchant.status]}
        </span>
      </header>

      <div className="split">
        <div className="split__main">
          {merchant.rejectionReason ? (
            <section className="section">
              <div className="section__head">
                <h2 className="section__title">Причина отказа</h2>
                <span className="section__rule" />
              </div>
              <p className="note">{merchant.rejectionReason}</p>
            </section>
          ) : undefined}

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Анкета</h2>
              <span className="section__rule" />
            </div>
            <div className="field">
              <span className="label">Что собираются делать</span>
              <span>{merchant.about ?? <span className="muted">Не написали</span>}</span>
            </div>
          </section>

          {actor.role === 'admin' ? (
            <MerchantActions merchantId={merchant.id} status={merchant.status} />
          ) : undefined}

          {/*
            Те же числа, что мерчант видит в обзоре кабинета, за тот же
            период: заявки по подаче, деньги по исполнению, валюты
            раздельно. Плитка с вызовами API и доставками отвечает на
            «у нас интеграция встала» раньше, чем об этом спросят.
          */}
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">
                {PERIOD_LABELS[period.key]}: <Moment at={period.from.toISOString()} mode="day" />{' '}
                — <Moment at={lastDay.toISOString()} mode="day" />
              </h2>
              <span className="section__rule" />
            </div>
            <PeriodChips
              current={period.key}
              basePath={`/merchants/${merchant.id}`}
              from={dayOf(period.from, offset)}
              to={dayOf(lastDay, offset)}
            />
            <Stats>
              <ExchangeCountTiles current={current} previous={previous} />
              <IntegrationTiles
                apiCalls={current.apiCalls}
                webhookDeliveries={current.webhookDeliveries}
              />
            </Stats>
            <div className="field">
              <span className="label">Оборот по исполненным — по каждой валюте отдельно</span>
              <MoneyCompare now={current.turnover} before={previous.turnover} />
            </div>
          </section>

          {/*
            Ключи без секретов — их нет и у нас — и последняя активность:
            «интеграция встала» отличается от «ключом не пользовались» по
            этой колонке. Отзывает ключи сам мерчант; панель только видит.
          */}
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Ключи API</h2>
              <span className="section__rule" />
            </div>
            {keys.length === 0 ? (
              <p className="note">Ключей не выпускал: по API заявок не подаёт.</p>
            ) : (
              <ul className="rows rows--tight">
                {keys.map((key) => (
                  <li key={key.id} className="row">
                    <span className="row__main">
                      <span className="row__title">
                        {key.label} <span className="mono muted">{key.hint}</span>
                      </span>
                      <span className="row__meta">
                        выпущен <Moment at={key.issuedAt.toISOString()} mode="day" />
                        {key.lastUsedAt ? (
                          <>
                            {' · последний вызов '}
                            <Moment at={key.lastUsedAt.toISOString()} />
                          </>
                        ) : (
                          ' · вызовов не было'
                        )}
                      </span>
                    </span>
                    <span className={key.revokedAt ? 'pill pill--off' : 'pill'}>
                      {key.revokedAt ? 'Отозван' : 'Действует'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/*
            Здоровье доставок: точка, которая не отвечает, объясняет
            вопрос «почему мне не приходят вебхуки» раньше, чем его зададут.
          */}
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Вебхуки</h2>
              <span className="section__rule" />
            </div>
            {hooks.length === 0 ? (
              <p className="note">Точек не заводил.</p>
            ) : (
              <ul className="rows rows--tight">
                {hooks.map((hook) => (
                  <li key={hook.id} className="row">
                    <span className="row__main">
                      <span className="row__title mono">{hook.url}</span>
                      <span className="row__meta">
                        {hook.events.map((one) => WEBHOOK_EVENT_LABELS[one]).join(', ')}
                        {hook.deliveries > 0 ? ` · доставок: ${hook.deliveries}` : ' · доставок не было'}
                        {hook.lastDelivery ? (
                          <>
                            {' · последняя '}
                            <Moment at={hook.lastDelivery.at.toISOString()} />
                            {` — ${WEBHOOK_DELIVERY_STATUS_LABELS[hook.lastDelivery.status].toLowerCase()}`}
                          </>
                        ) : undefined}
                      </span>
                    </span>
                    {/* Золотом — то, что зовёт человека: точка, которая не отвечает. */}
                    <span className={hook.state === 'failing' ? 'pill pill--gold' : 'pill'}>
                      {WEBHOOK_ENDPOINT_STATE_LABELS[hook.state]}
                      {hook.failingSince ? (
                        <>
                          {' с '}
                          <Moment at={hook.failingSince.toISOString()} />
                        </>
                      ) : undefined}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Заявки</h2>
              <Link className="section__action" href={`/?merchant=${merchant.id}`}>
                Все в столе
              </Link>
              <span className="section__rule" />
            </div>
            {requests.length === 0 ? (
              <EmptyState
                icon="exchange"
                title="Заявок пока нет"
                text={
                  merchant.status === 'active'
                    ? 'Поданные встанут сюда и в общий стол — с пометкой «Мерчант».'
                    : 'Подавать заявки мерчант сможет после одобрения.'
                }
              />
            ) : (
              <ul className="rows">
                {requests.map(toExchangeRow).map((row) => (
                  <li key={row.id} className="row">
                    <Link className="row__main" href={`/exchange-requests/${row.id}`}>
                      <span className="row__title">
                        {row.fromAmount} {row.fromCode} → {row.toAmount ?? ''} {row.toCode}
                      </span>
                      <span className="row__meta">
                        {row.party.kind === 'merchant' && row.party.reference
                          ? `${row.party.reference} · `
                          : ''}
                        <Moment at={row.createdAt} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <MerchantCard merchant={toMerchantCardData(merchant)} linked={false} />
      </div>
    </main>
  );
}
