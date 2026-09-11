import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { PREVIEW_NOTE } from '@/lib/pos-texts';
import { viewer } from '@/lib/reads';
import { InvoiceActions } from './invoice-actions';

export const dynamic = 'force-dynamic';

/**
 * Карточка счёта: сумма крупно, эквивалент по записанному курсу,
 * назначение, лента «что происходило» и то, что со счётом делают.
 *
 * Эквивалент — по курсу из самого счёта, а не по сегодняшнему:
 * исторического курса у сервиса нет, а пересчитать вчерашний счёт
 * сегодняшним значит поменять сумму, которую покупатель уже видел.
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor } = await viewer();
  const { id } = await params;
  const invoice = findInvoice(actor.merchantId, id);
  if (!invoice) notFound();

  const refunds = listRefunds(actor.merchantId).filter((one) => one.invoiceId === invoice.id);

  return (
    <main className="page">
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
        <p className="pos__value">{formatMoney(invoice.amount, invoice.code)}</p>
        <p className="pos__equal">
          {formatMoney(invoice.payAmount, invoice.payCode)} по курсу{' '}
          {formatRate(invoice.rate, invoice.payCode, invoice.code)}
        </p>
        <p className="card__note">
          Курс записан при создании счёта: по нему считается эквивалент и потом.
        </p>

        <ul className="rows rows--tight">
          <li className="row">
            <div className="row__main">
              <span className="row__title">
                <span className={`pill pill--${INVOICE_STATUS_TONES[invoice.status]}`}>
                  {INVOICE_STATUS_LABELS[invoice.status]}
                </span>
              </span>
              <span className="row__meta">
                выставил {invoice.author} · <Moment at={invoice.createdAt} />
              </span>
            </div>
          </li>
          {invoice.purpose ? (
            <li className="row">
              <div className="row__main">
                <span className="row__title">{invoice.purpose}</span>
                <span className="row__meta">назначение</span>
              </div>
            </li>
          ) : undefined}
          {invoice.buyer ? (
            <li className="row">
              <div className="row__main">
                <span className="row__title">{invoice.buyer}</span>
                <span className="row__meta">покупатель</span>
              </div>
            </li>
          ) : undefined}
        </ul>

        <InvoiceActions
          id={invoice.id}
          status={invoice.status}
          code={invoice.code}
          left={refundLeft(invoice, listRefunds(actor.merchantId))}
        />
      </section>

      <section className="card">
        <h2 className="card__title">Что происходило</h2>
        <p className="card__note">Лента счёта: время печатает браузер, а не сервер</p>
        <ul className="rows rows--tight">
          {invoice.events.map((event) => (
            <li key={`${event.at}-${event.what}`} className="row">
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
              <p className="card__note">Решение принимает менеджер — этой части пока нет</p>
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
