import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isCoreError } from '@nemo/http';
import {
  describeRequisites,
  isUuid,
  merchantRoleCan,
  REQUISITE_KIND_LABELS,
} from '@nemo/types';
import { CopyValue, Moment, QuietRefresh } from '@nemo/ui';
import { formatMoney, formatRate } from '@nemo/ui/format';
import { getCore } from '@/lib/core';
import { viewer } from '@/lib/reads';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/labels';
import { paymentBlockOf, SUBMITTED_VIA } from '@/lib/request-card';
import {
  deliveryWords,
  pathWithHistory,
  type TrailDeliveryInput,
} from '@/lib/request-trail';
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
  const { actor, session } = await viewer();
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
  /*
   * Доставки вебхуков — вторая половина истории, и видит её тот, кому
   * видна интеграция: у владельца (ADR-0023). Решает операция, а не
   * экран — оператору она откажет, — поэтому экран её и не зовёт: лента
   * у оператора остаётся лентой состояний, а не пятисотым ответом.
   */
  const seesHooks = merchantRoleCan(session.role, 'integration');
  /*
   * Ключ подачи называется подписью, а не идентификатором: «сайт»,
   * «бухгалтерия» — так мерчант его и завёл. Подпись живёт у ключа и
   * меняется, поэтому читается сейчас, а не копируется в заявку.
   * Список ключей — у того же, кому видна интеграция.
   */
  const keys = seesHooks && request.apiKeyId ? await core.listApiKeys(actor) : [];
  const submittedKey = keys.find((one) => one.id === request.apiKeyId);
  const [events, terms, recipient, deliveries] = await Promise.all([
    core.listExchangeRequestEventsForOwner(actor, id),
    core.getExchangeTerms(),
    // Отдельной операцией, а не списком получателей: поданная по API
    // запись архивируется сразу, и список её не отдаёт.
    core.getExchangeRequestRecipient(actor, id),
    seesHooks ? core.listWebhookDeliveries(actor, { requestId: id }) : Promise.resolve([]),
  ]);
  const rate = request.finalRate ?? request.requestRate;
  const payment = paymentBlockOf(request);
  /*
   * Путь вместе с историей: время шага и его вебхуки стоят под самим
   * шагом. Отдельного блока «Что происходило» больше нет — он повторял
   * строку пути теми же словами, только столбиком.
   */
  const path = pathWithHistory(request, events, deliveries);

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
            страницы. Нет своего — заголовком остаётся наш: свой номер
            интеграция называть не обязана.
          */}
          <h1 className="page__title page__title--own">
            {request.reference ?? `Заявка ${request.id.slice(0, 8)}`}
          </h1>
          <p className="page__sub">
            {KIND_LABELS[request.kind]} · подана{' '}
            {request.source ? `${SUBMITTED_VIA[request.source]}` : ''}
            {submittedKey ? `, ключ «${submittedKey.label}»` : ''}
            {request.source ? ' · ' : ''}
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
        <ol className={path.waitsForMerchant ? 'path path--wait' : 'path'}>
          {path.steps.map((step) => (
            <li
              key={step.label}
              className={`path__step path__step--${step.state}`}
              {...(step.state === 'current' ? { 'aria-current': 'step' as const } : {})}
            >
              <span className="path__mark" aria-hidden="true" />
              <span className="path__label">{step.label}</span>
              {/*
                Время — когда заявка дошла до шага. Место под ним занято и
                у шагов впереди: иначе подписи пройденных и будущих шагов
                стояли бы на разной высоте.
              */}
              <span className="path__when">
                {step.at ? <Moment at={step.at.toISOString()} /> : '\u00a0'}
              </span>
              <Hooks deliveries={step.deliveries} />
            </li>
          ))}
        </ol>
        <p className={path.waitsForMerchant ? 'path__note path__note--wait' : 'path__note'}>
          {path.note}
        </p>
        {/*
          Отмена — не шаг пути: у шага, на котором заявка оборвалась,
          время своё, и «отменена в 17:30» под ним читалась бы как «курс
          подтверждён в 17:30».
        */}
        {path.cancelled ? (
          <div className="path__cancelled">
            <span>
              Отменена <Moment at={path.cancelled.at.toISOString()} />
            </span>
            <Hooks deliveries={path.cancelled.deliveries} />
          </div>
        ) : undefined}
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
        Куда ушли деньги — первый вопрос при жалобе покупателя: мерчант
        сверяет карту из своей системы с той, на которую отправил
        сервис. Открытый хвост, а не номер целиком: расшифровывать в
        клиентском контуре нечем (ADR-0002), и сверке он не нужен. У
        заявки без получателя блока нет вовсе, а не прочерк.
      */}
      {recipient ? (
        <section className="card">
          <h2 className="card__title">Получатель</h2>
          <p className="card__note">{REQUISITE_KIND_LABELS[recipient.kind]}</p>
          <p className="recipient">{describeRequisites(recipient)}</p>
          {recipient.holderName ? <p className="muted">{recipient.holderName}</p> : undefined}
        </section>
      ) : undefined}

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

      {request.status === 'new' ? <CancelRequest id={request.id} /> : undefined}
    </main>
  );
}

/**
 * Вебхуки шага: узнала ли о переходе система мерчанта. Под своим шагом,
 * а не отдельным списком: вопрос задают про переход — «вы говорите,
 * исполнено, а у нас висит».
 */
function Hooks({ deliveries }: { readonly deliveries: readonly TrailDeliveryInput[] }) {
  if (deliveries.length === 0) return null;
  return (
    <ul className="path__hooks">
      {deliveries.map((one) => {
        const words = deliveryWords(one);
        return (
          <li key={one.id} className={`path__hook path__hook--${words.tone}`}>
            {/*
              Ведёт в историю точки: страницы одной доставки у кабинета
              нет, а ответ приёмника виден там.
            */}
            <Link href={`/webhooks?endpoint=${one.endpointId}`}>вебхук {words.text}</Link>
            {one.status === 'pending' && one.attempt > 0 ? (
              <span className="muted">
                снова <Moment at={one.nextAttemptAt.toISOString()} />
              </span>
            ) : undefined}
          </li>
        );
      })}
    </ul>
  );
}
