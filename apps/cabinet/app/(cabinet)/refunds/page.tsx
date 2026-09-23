import Link from 'next/link';
import { CurrencyFlag } from '@nemo/flags';
import { sortCurrencies } from '@nemo/types';
import { EmptyState, firstParam, HowTo, Moment, Stat, Stats, Tabs } from '@nemo/ui';
import { formatMoney } from '@nemo/ui/format';
import {
  REFUND_COLUMN_LABELS,
  REFUND_STATUS_LABELS,
  REFUND_STATUS_TONES,
  countByStatus,
  refundBreakdown,
  refundCell,
  refundColumns,
  refundStatuses,
  refundSummary,
  type RefundStatus,
} from '@/lib/invoice-rows';
import { allowedHere } from '@/lib/access';
import { getCore } from '@/lib/core';
import { listRefunds } from '@/lib/mock/store';
import { PREVIEW_NOTE, REFUNDS_HOW_TO, REFUNDS_NOTE } from '@/lib/pos-texts';
import { viewer } from '@/lib/reads';
import { CurrencyBreakdown } from '@/app/ui/currency-breakdown';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';
import { PosLive } from '@/app/ui/pos-live';

export const dynamic = 'force-dynamic';

/** Куда идут заводить возврат: он делается с оплаченным счётом. */
const PAID_INVOICES = '/invoices?tab=paid';

/**
 * Возвраты: список заявок и числа над ним — устройство взято у образца
 * Love&Pay (раздел «Возвраты»), детали и слова — те же, что у счетов.
 *
 * Заводятся они не здесь, а в карточке оплаченного счёта: возврат — это
 * то, что делают с конкретным платежом, и раздел, в котором его
 * начинают, требовал бы сначала найти счёт по номеру. Поэтому
 * единственное действие шапки ведёт к оплаченным счетам.
 *
 * Исполняет возврат тот, кто принимал платёж, — провайдер приёма. У
 * банка между заявкой и деньгами стоят часы и решение, и заявка ждёт в
 * «Ожидает»; у имитации ждать некого, и возврат исполнен сразу. Счёт,
 * оплаченный руками мимо сервиса, возвращать некому — его заявка ждёт,
 * и строка говорит об этом словами.
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
  const summary = refundSummary(all);

  // Валюты — все, что сервис выдаёт, и те, что встретились в возвратах:
  // «рублями не возвращали» — такой же ответ, как «вернули 1 900 батов».
  // Валюты не складываются между собой (docs/adr/0013).
  const terms = await getCore().getExchangeTerms();
  const codes = sortCurrencies([
    ...new Set([...terms.currencies.map((one) => one.code), ...all.map((one) => one.code)]),
  ]);
  const owed = refundBreakdown(all, codes).map((line) => ({
    code: line.code,
    amount: line.amount === null ? null : formatMoney(line.amount, line.code),
    count: line.count,
  }));

  const inWorkNote =
    summary.inWork === 0
      ? 'ничего не ждёт'
      : [
          summary.pending > 0 ? `ожидают: ${summary.pending}` : '',
          summary.approved > 0 ? `одобрены: ${summary.approved}` : '',
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <main className="page page--wide">
      <PosLive />
      <DisabledBanner status={session.status} />

      <header className="page__head pos-head">
        <div className="pos-head__intro">
          <h1 className="page__title">Возвраты</h1>
          <p className="page__sub">
            {REFUNDS_NOTE} {PREVIEW_NOTE}
          </p>
        </div>
        <div className="page__actions">
          {/* «Оплаченные счета» — слово владельца со звонка 8 сентября. */}
          <Link className="btn btn--ghost" href={PAID_INVOICES}>
            Оплаченные счета
          </Link>
        </div>
      </header>

      <HowTo
        title="Как устроены возвраты"
        sub="Где заявить, состояния и что считают плитки"
        items={REFUNDS_HOW_TO}
      />

      <Stats>
        <Stat
          label="Заявок"
          value={summary.total}
          note={summary.rejected > 0 ? `отклонено: ${summary.rejected}` : 'отклонённых нет'}
        />
        {/*
          «В работе» — всё, по чему деньги ещё не ушли. Золотом — только
          когда ждущая заявка есть: её исполнять некому, и она зовёт
          человека; одобренную исполнит банк.
        */}
        <Stat
          label="В работе"
          value={summary.inWork}
          note={inWorkNote}
          tone={summary.pending > 0 ? 'wait' : 'plain'}
        />
        <Stat
          label="Исполнены"
          value={summary.done}
          note={summary.done === 0 ? 'пока ни одного' : 'деньги у покупателей'}
          tone={summary.done > 0 ? 'up' : 'plain'}
        />
        {/*
          Суммы по валютам — тем же приёмом, что «По валютам» у счетов:
          столбиком со значком, до трёх свёрнутыми, нажатием — все
          валюты сервиса. Строки списка никуда не ведут: переключать
          здесь нечего, список отвечает «сколько и в чём».
        */}
        <Stat
          label="К возврату"
          value={
            <CurrencyBreakdown
              lines={owed}
              title="К возврату по всем валютам"
              empty="нечего возвращать"
              none="не возвращали"
            />
          }
          note="обещано покупателям, без отклонённых"
        />
      </Stats>

      <div className="listbar">
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
      </div>

      {rows.length === 0 ? (
        all.length === 0 ? (
          <EmptyState
            icon="card"
            title="Возвратов пока нет"
            text="Возврат заводится в карточке оплаченного счёта, целиком или частью, с причиной."
            action={
              <Link className="btn btn--ghost" href={PAID_INVOICES}>
                Оплаченные счета
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon="card"
            title="В этом состоянии пусто"
            text="Возьмите другое состояние или посмотрите все возвраты."
            action={
              <Link className="btn btn--ghost" href="/refunds">
                Все возвраты
              </Link>
            }
          />
        )
      ) : (
        <div className="scroll-x">
          <table className="datatable">
            <thead>
              <tr>
                {/*
                  У колонки кнопок подписи на экране нет, но диктору она
                  названа — атрибутом, как у списка счетов.
                */}
                {refundColumns.map((column) =>
                  column === 'open' ? (
                    <th key={column} aria-label={REFUND_COLUMN_LABELS[column]} />
                  ) : (
                    <th
                      key={column}
                      className={column === 'amount' || column === 'retained' || column === 'created' ? 'num' : undefined}
                    >
                      {REFUND_COLUMN_LABELS[column]}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((one) => (
                <tr key={one.id}>
                  {refundColumns.map((column) => {
                    const cell = refundCell(one, column);
                    return (
                      <td key={column} className={cell.numeric || column === 'open' ? 'num' : undefined}>
                        {column === 'invoice' ? (
                          <Link href={`/invoices/${one.invoiceId}`}>{cell.text}</Link>
                        ) : column === 'status' ? (
                          <span className={`pill pill--${REFUND_STATUS_TONES[one.status]}`}>{cell.text}</span>
                        ) : column === 'created' ? (
                          <Moment at={one.createdAt} />
                        ) : column === 'open' ? (
                          // Подробности возврата живут в карточке его счёта:
                          // там сумма счёта, остаток и лента, где видно, чем
                          // возврат кончился.
                          <Link
                            className="btn btn--ghost btn--tiny"
                            href={`/invoices/${one.invoiceId}`}
                            aria-label={`${cell.text}: возврат по счёту ${one.invoiceNumber}`}
                          >
                            {cell.text}
                          </Link>
                        ) : column === 'reason' ? (
                          <span className="refunds__reason">{cell.text}</span>
                        ) : cell.flag ? (
                          // Сумма — значком валюты и жирнее прочего: за ней
                          // в список и приходят.
                          <span className="money-cell">
                            <CurrencyFlag code={cell.flag} size={16} />
                            {cell.text}
                          </span>
                        ) : (
                          cell.text
                        )}
                        {column === 'created' && one.doneAt ? (
                          <span className="row__meta">
                            исполнен <Moment at={one.doneAt} />
                          </span>
                        ) : cell.meta && column !== 'created' ? (
                          <span className="row__meta">{cell.meta}</span>
                        ) : undefined}
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
