import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { EmptyState, Moment } from '@nemo/ui';
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
 * Вебхуки и статистика встанут сюда позже — их дописывают свои тикеты.
 */
export default async function MerchantPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const { id } = await params;
  const core = getCore();

  const merchant = await core.getMerchantCard(actor, id).catch((error: unknown) => {
    if (error instanceof CoreError && error.code === 'not-found') {
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
  const [requests, keys] = await Promise.all([
    core.listMerchantExchangeRequests(actor, id, { limit: 10 }),
    core.listMerchantApiKeys(actor, id),
  ]);

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
