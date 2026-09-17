import { notFound, redirect } from 'next/navigation';
import { isCoreError } from '@nemo/http';
import { isUuid } from '@nemo/types';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { toClientCardData } from '@/lib/client-card';
import { toMerchantCardData, toOwnerData } from '@/lib/merchant-card';
import { getCore } from '@/lib/core';
import { ExchangeRequestCard } from './exchange-request-card';

export const dynamic = 'force-dynamic';

/**
 * Карточка заявки: всё, что менеджеру нужно знать и сделать, на одном
 * экране — состояние, история переходов и доступные действия.
 */
export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const { id } = await params;
  /*
   * Номер не того вида — тоже «не найдено»: база на него отвечает не
   * пустотой, а ошибкой, и менеджер видел бы страницу аварии.
   */
  if (!isUuid(id)) {
    notFound();
  }
  const core = getCore();

  /*
   * Заявки с таким идентификатором нет — это «не найдено», а не авария:
   * адрес мог остаться в закладке от удалённой заявки или быть набран
   * руками. Страница ошибки на такое пугает менеджера сильнее, чем
   * стоило бы. Всё остальное пробрасывается: отказавшая база — как раз
   * авария, и прятать её за «не найдено» значит её потерять.
   */
  const [request, events] = await Promise.all([
    core.getExchangeRequestForStaff(actor, id),
    core.listExchangeRequestEvents(actor, id),
  ]).catch((error: unknown) => {
    if (isCoreError(error) && error.code === 'not-found') {
      notFound();
    }
    throw error;
  });

  /*
   * Карточка владельца — вторым запросом, а не полем заявки: она нужна
   * менеджеру на экране, но к самой сделке отношения не имеет, и
   * заявка, таскающая профиль клиента, начала бы расходиться с ним.
   * Клиента может не быть: заявку подаёт тот, кто уже завёлся, но
   * запись могли и удалить.
   *
   * У заявки мерчанта вместо неё карточка мерчанта (docs/adr/0017):
   * вопрос «с кем имею дело» тот же, но переписки, баллов и рефералки у
   * него нет — есть анкета и контакты.
   */
  const owner = request.owner;
  const card =
    owner.kind === 'client'
      ? await core.getClientCard(actor, owner.clientId).catch((error: unknown) => {
          if (isCoreError(error) && error.code === 'not-found') return null;
          throw error;
        })
      : null;
  const merchant =
    owner.kind === 'merchant'
      ? await core.getMerchantCard(actor, owner.merchantId).catch((error: unknown) => {
          if (isCoreError(error) && error.code === 'not-found') return null;
          throw error;
        })
      : null;

  /*
   * Счета сервиса — только в той валюте, которой платит клиент, и
   * только действующие: остальные менеджеру выбирать нельзя, а
   * показанные и отвергнутые операцией — это ошибка, до которой дали
   * дотянуться (docs/adr/0008). У наличной заявки счёта нет по
   * устройству сделки — деньги приносят на руках, — и список её
   * карточке не запрашивается вовсе.
   *
   * Наценка — чтобы панель подсказала доход по заявке. Считает его
   * панель, а не операция: число уходит в реферальные начисления, и
   * подтверждать его должен человек.
   */
  const [accounts, markupBps, pricedBySchedule, colleagues] = await Promise.all([
    request.kind === 'electronic'
      ? core.listServiceAccounts(actor, {
          currencyCode: request.fromCode,
          activeOnly: true,
        })
      : [],
    core.getServiceMarkupBps(actor),
    /*
     * Считается ли цена сеткой ступеней. У такой заявки наценки в курсе
     * нет, и подсказка дохода по ней молчит: посчитанное по наценке
     * число было бы выдумкой, поданной как расчёт.
     */
    core.isRequestPricedBySchedule(actor, id),
    // Кому можно передать заявку: активные сотрудники, одни имена.
    core.listColleagues(actor),
  ]);

  return (
    <ExchangeRequestCard
      request={{ ...request, owner: toOwnerData(request.owner) }}
      events={events}
      accounts={accounts}
      markupBps={markupBps}
      pricedBySchedule={pricedBySchedule}
      client={card ? toClientCardData(card) : null}
      merchant={merchant ? toMerchantCardData(merchant) : null}
      viewerStaffId={actor.staffId}
      viewerRole={actor.role}
      colleagues={colleagues}
    />
  );
}
