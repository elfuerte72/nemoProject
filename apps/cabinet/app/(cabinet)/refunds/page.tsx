import Link from 'next/link';
import { EmptyState, firstParam, HowTo, Moment, Stat, Stats, Tabs } from '@nemo/ui';
import { Money } from '@nemo/types';
import { formatByCurrency } from '@nemo/ui/money-list';
import {
  REFUND_COLUMN_LABELS,
  REFUND_STATUS_LABELS,
  REFUND_STATUS_TONES,
  countByStatus,
  owedRefunds,
  refundCell,
  refundColumns,
  refundStatuses,
  type RefundStatus,
} from '@/lib/invoice-rows';
import { allowedHere } from '@/lib/access';
import { listRefunds } from '@/lib/mock/store';
import { PREVIEW_NOTE, REFUNDS_HOW_TO } from '@/lib/pos-texts';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';

export const dynamic = 'force-dynamic';

/**
 * Возвраты: список заявок и числа над ним.
 *
 * Заводятся они не здесь, а в карточке оплаченного счёта: возврат — это
 * то, что делают с конкретным платежом, и раздел, в котором его
 * начинают, требовал бы сначала найти счёт по номеру.
 *
 * Решение принимает менеджер, и этой части пока нет — заявка остаётся в
 * состоянии «Ожидает». Остальные табы стоят пустыми: путь заявки виден
 * целиком, а рисовать переход, которого никто не делает, нельзя.
 */
export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await allowedHere('/refunds');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { actor, session } = await viewer();
  const params = await searchParams;
  const all = listRefunds(actor.merchantId);
  const tab = firstParam(params.tab);
  const status = (refundStatuses as readonly string[]).includes(tab ?? '')
    ? (tab as RefundStatus)
    : undefined;
  const rows = status === undefined ? all : all.filter((one) => one.status === status);

  // Валюты не складываются между собой — по строке на каждую, той же
  // арифметикой, что у денег везде (docs/adr/0013).
  // Отклонённые не в счёт: по ним ничего не уходит. Правило то же, по
  // которому считается остаток по счёту, и взято оно оттуда же.
  const owed = owedRefunds(all);
  const byCurrency = [...new Set(owed.map((one) => one.code))]
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({
      code,
      amount: owed
        .filter((one) => one.code === code)
        .reduce((sum, one) => Money.add(sum, one.amount), Money.ZERO),
    }));

  return (
    <main className="page page--wide">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Возвраты</h1>
          <p className="page__sub">{PREVIEW_NOTE}</p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--soft btn--tiny" href="/invoices">
            Счета
          </Link>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Кто заводит возврат и что с ним дальше" items={REFUNDS_HOW_TO} />

      <Stats>
        <Stat label="Заявок" value={all.length} note="всего" />
        <Stat
          label="Ждут решения"
          value={countByStatus(all, 'pending')}
          note="менеджер их пока не видит"
          tone={countByStatus(all, 'pending') > 0 ? 'wait' : 'plain'}
        />
        <Stat
          label="К возврату"
          value={formatByCurrency(byCurrency)}
          note="по валютам, без сложения между собой"
        />
      </Stats>

      <Tabs
        label="Состояния возвратов"
        items={[
          { href: '/refunds', label: 'Все', count: all.length, current: status === undefined },
          ...refundStatuses.map((one) => ({
            href: `/refunds?tab=${one}`,
            label: REFUND_STATUS_LABELS[one],
            count: countByStatus(all, one),
            current: status === one,
          })),
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="card"
          title={all.length === 0 ? 'Возвратов пока нет' : 'В этом состоянии пусто'}
          text={
            all.length === 0
              ? 'Возврат заводится в карточке оплаченного счёта — целиком или частью, с причиной.'
              : 'Заявки ждут решения менеджера; этой части пока нет.'
          }
        />
      ) : (
        <div className="scroll-x">
          <table className="datatable">
            <thead>
              <tr>
                {refundColumns.map((column) => (
                  <th key={column} className={column === 'amount' || column === 'retained' || column === 'created' ? 'num' : undefined}>
                    {REFUND_COLUMN_LABELS[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((one) => (
                <tr key={one.id}>
                  {refundColumns.map((column) => {
                    const cell = refundCell(one, column);
                    return (
                      <td key={column} className={cell.numeric ? 'num' : undefined}>
                        {column === 'invoice' ? (
                          <Link href={`/invoices/${one.invoiceId}`}>{cell.text}</Link>
                        ) : column === 'status' ? (
                          <span className={`pill pill--${REFUND_STATUS_TONES[one.status]}`}>
                            {cell.text}
                          </span>
                        ) : column === 'created' ? (
                          <Moment at={one.createdAt} mode="day" />
                        ) : (
                          cell.text
                        )}
                        {cell.meta ? <span className="row__meta"> {cell.meta}</span> : undefined}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
