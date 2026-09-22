import Link from 'next/link';
import { notFound } from 'next/navigation';
import { merchantRoleCan } from '@nemo/types';
import { Moment } from '@nemo/ui';
import { formatMoney, formatRate } from '@nemo/ui/format';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  REFUND_STATUS_LABELS,
  REFUND_STATUS_TONES,
  refundLeft,
} from '@/lib/invoice-rows';
import { findInvoice, listRefunds } from '@/lib/mock/store';
import { acquirer, IMITATION, QR_TTL_MS } from '@/lib/pos/acquirer';
import { isPayable } from '@/lib/pos/lifecycle';
import { markupPercent } from '@/lib/pos/settings';
import { PREVIEW_NOTE } from '@/lib/pos-texts';
import { viewer } from '@/lib/reads';
import { PosLive } from '@/app/ui/pos-live';
import { InvoiceActions } from './invoice-actions';

export const dynamic = 'force-dynamic';

/**
 * Карточка счёта: сумма крупно, эквивалент по записанному курсу, QR,
 * пока счёт ждёт денег, назначение, лента «что происходило» и то, что
 * со счётом делают.
 *
 * Эквивалент — по курсу из самого счёта, а не по сегодняшнему:
 * исторического курса у сервиса нет, а пересчитать вчерашний счёт
 * сегодняшним значит поменять сумму, которую покупатель уже видел.
 *
 * Экран перечитывает себя по событиям терминала: оплата, пришедшая,
 * пока карточка открыта, видна без перезагрузки.
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor, session } = await viewer();
  const { id } = await params;
  const now = new Date();
  const invoice = findInvoice(actor.merchantId, id, now);
  if (!invoice) notFound();

  const refunds = listRefunds(actor.merchantId).filter((one) => one.invoiceId === invoice.id);
  // Без провайдера карточка всё равно читается: без QR и без кнопки оплаты.
  const provider = ((): ReturnType<typeof acquirer> | null => {
    try {
      return acquirer();
    } catch {
      return null;
    }
  })();
  const payable = isPayable(invoice, now);
  const qr =
    provider && invoice.payment && payable ? await provider.qr(invoice.payment.ref, now) : null;

  return (
    <main className="page">
      <PosLive />
      <header className="page__head">
        <div>
          <h1 className="page__title">Счёт {invoice.number}</h1>
          <p className="page__sub">{PREVIEW_NOTE}</p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--soft btn--tiny" href="/invoices">
            Все счета
          </Link>
        </div>
      </header>

      <section className="card">
        <div className="invoice__top">
          <div>
            <p className="pos__value">{formatMoney(invoice.payAmount, invoice.payCode)}</p>
            <p className="pos__equal">
              за {formatMoney(invoice.amount, invoice.code)} по курсу{' '}
              {formatRate(invoice.rate, invoice.payCode, invoice.code)}
              {invoice.markupBps > 0 ? ` · ваша наценка ${markupPercent(invoice.markupBps)} %` : ''}
            </p>
            <p className="card__note">
              Курс записан при создании счёта: по нему считается эквивалент и потом.
            </p>
          </div>
          {qr ? (
            <figure className="invoice__qr">
              <img
                src={`/api/pos/invoices/${invoice.id}/qr?at=${encodeURIComponent(qr.issuedAt)}`}
                alt={`QR для оплаты счёта ${invoice.number}`}
                width={180}
                height={180}
              />
              <figcaption className="hint">
                {provider?.name === IMITATION ? 'QR ненастоящий: платёж принимает имитация. ' : ''}
                Код обновляется каждые {Math.round(QR_TTL_MS / 60_000)} минут
                {invoice.expiresAt ? (
                  <>
                    , счёт действует до <Moment at={invoice.expiresAt} />
                  </>
                ) : undefined}
                .
              </figcaption>
            </figure>
          ) : undefined}
        </div>

        <ul className="rows rows--tight">
          <li className="row">
            <div className="row__main">
              <span className="row__title">
                <span className={`pill pill--${INVOICE_STATUS_TONES[invoice.status]}`}>
                  {INVOICE_STATUS_LABELS[invoice.status]}
                </span>
                {invoice.demo ? <span className="pill">пример</span> : undefined}
              </span>
              <span className="row__meta">
                создал {invoice.author} · <Moment at={invoice.createdAt} />
                {invoice.status === 'issued' && invoice.expiresAt ? (
                  <>
                    {' '}· действует до <Moment at={invoice.expiresAt} />
                  </>
                ) : undefined}
              </span>
            </div>
          </li>
          {invoice.payment ? (
            <li className="row">
              <div className="row__main">
                <span className="row__title">
                  {invoice.payment.provider === IMITATION ? 'Имитация' : invoice.payment.provider}
                </span>
                <span className="row__meta">принимает платёж · {invoice.payment.ref}</span>
              </div>
            </li>
          ) : undefined}
          {invoice.kycRequired ? (
            <li className="row">
              <div className="row__main">
                <span className="row__title">
                  {invoice.kycPassedAt ? 'Личность покупателя подтверждена' : 'Требуется верификация покупателя'}
                </span>
                <span className="row__meta">
                  {invoice.kycPassedAt ? <Moment at={invoice.kycPassedAt} /> : 'перед оплатой, у провайдера'}
                </span>
              </div>
            </li>
          ) : undefined}
        </ul>

        {/*
          Действия — тем, у кого есть право POS-терминала: наблюдателю
          маршрут откажет (`requireTill`), и кнопка вела бы в отказ.
        */}
        {merchantRoleCan(session.role, 'till') ? (
          <InvoiceActions
            id={invoice.id}
            status={invoice.status}
            payable={payable}
            imitation={provider?.name === IMITATION && invoice.payment?.provider === IMITATION}
            code={invoice.code}
            left={refundLeft(invoice, listRefunds(actor.merchantId))}
          />
        ) : undefined}
      </section>

      <section className="card">
        <h2 className="card__title">Что происходило</h2>
        <p className="card__note">Лента счёта: время печатает браузер, а не сервер</p>
        <ul className="rows rows--tight">
          {invoice.events.map((event, index) => (
            <li key={`${event.at}-${index}`} className="row">
              <div className="row__main">
                <span className="row__title">{event.what}</span>
                <span className="row__meta">
                  <Moment at={event.at} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {refunds.length > 0 ? (
        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Возвраты по счёту</h2>
              <p className="card__note">Исполняет тот, кто принимал платёж</p>
            </div>
            <Link className="btn btn--ghost btn--tiny" href="/refunds">
              Все возвраты
            </Link>
          </div>
          <ul className="rows rows--tight">
            {refunds.map((one) => (
              <li key={one.id} className="row">
                <div className="row__main">
                  <span className="row__title">{formatMoney(one.amount, one.code)}</span>
                  <span className="row__meta">
                    {one.reason} · <Moment at={one.createdAt} />
                    {one.retained ? ` · остаётся у вас ${formatMoney(one.retained, one.code)}` : ''}
                  </span>
                </div>
                <span className={`pill pill--${REFUND_STATUS_TONES[one.status]}`}>
                  {REFUND_STATUS_LABELS[one.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : undefined}
    </main>
  );
}
