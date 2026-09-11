import { cookies } from 'next/headers';
import Link from 'next/link';
import {
  EmptyState,
  firstParam,
  HowTo,
  Moment,
  Stat,
  Stats,
  Tabs,
} from '@nemo/ui';
import { formatMoney } from '@nemo/ui/format';
import { formatByCurrency } from '@nemo/ui/money-list';
import { INVOICE_PREFS_COOKIE, readInvoiceColumns } from '@/lib/invoice-prefs';
import {
  INVOICE_COLUMN_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  countByStatus,
  invoiceCell,
  invoiceCurrencies,
  invoiceMoneyLines,
  invoiceStatuses,
  invoiceTotal,
  searchInvoices,
  type InvoiceStatus,
} from '@/lib/invoice-rows';
import { listInvoices } from '@/lib/mock/store';
import { INVOICES_HOW_TO, PREVIEW_NOTE } from '@/lib/pos-texts';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { Columns } from './columns';

export const dynamic = 'force-dynamic';

/**
 * Счета кассы: список с числами над ним.
 *
 * Макет без денег — записи живут в памяти процесса и до перезапуска
 * (`backlog.md`). Сказано об этом сверху: мерчант, потерявший счёт
 * после выкатки, решит, что сервис теряет деньги.
 *
 * Устроен как остальные списки кабинета: подсказка, плитки, табы со
 * счётчиками, поиск, личный набор колонок и выгрузка. Ничего своего в
 * нём нет — детали те же, что у заявок.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, session } = await viewer();
  const params = await searchParams;
  const jar = await cookies();
  const shown = readInvoiceColumns(jar.get(INVOICE_PREFS_COOKIE)?.value, actor.merchantId);

  const all = listInvoices(actor.merchantId);
  const query = firstParam(params.q) ?? '';
  const tab = firstParam(params.tab);
  const status = (invoiceStatuses as readonly string[]).includes(tab ?? '')
    ? (tab as InvoiceStatus)
    : undefined;

  const found = searchInvoices(all, query);
  const rows = status === undefined ? found : found.filter((one) => one.status === status);

  // Валюта итога — из адреса: складывать баты с юанями нечем, и валюту
  // выбирает тот, кто смотрит.
  const codes = invoiceCurrencies(all);
  const code = codes.includes(firstParam(params.code) ?? '') ? firstParam(params.code)! : 'RUB';
  const total = invoiceTotal(found, code);
  const paid = found.filter((one) => one.status === 'paid');

  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q: query || undefined, tab, code, ...over };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `/invoices?${text}` : '/invoices';
  };

  return (
    <main className="page page--wide">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Счета</h1>
          <p className="page__sub">{PREVIEW_NOTE}</p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--gold btn--tiny" href="/pos">
            В кассу
          </Link>
          <a className="btn btn--ghost btn--tiny" href={`/api/pos/invoices/csv?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(status ? { tab: status } : {}) }).toString()}`}>
            CSV
          </a>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Откуда счета и почему числа такие" items={INVOICES_HOW_TO} />

      <Stats>
        <Stat label="Счетов" value={found.length} note={query ? 'нашлось по запросу' : 'всего'} />
        <Stat
          label="Оплачено"
          value={paid.length}
          note="отмечаете вы сами: деньги идут мимо сервиса"
          tone={paid.length > 0 ? 'up' : 'plain'}
        />
        <Stat
          label={`Оборот, ${code}`}
          value={formatMoney(total.amount, code)}
          note={
            code === 'RUB'
              ? `по оплаченным, курсом каждого счёта · их ${total.count}`
              : `по оплаченным в этой валюте · их ${total.count}`
          }
        />
        <Stat
          label="По валютам"
          value={formatByCurrency(invoiceMoneyLines(found))}
          note="по оплаченным, без сложения между собой"
        />
      </Stats>

      {codes.length > 1 ? (
        <div className="chips">
          {codes.map((one) => (
            <Link
              key={one}
              href={href({ code: one })}
              className={one === code ? 'chip chip--on' : 'chip'}
              scroll={false}
            >
              Оборот в {one}
            </Link>
          ))}
        </div>
      ) : undefined}

      <div className="listbar">
        <Tabs
          label="Состояния счетов"
          items={[
            { href: href({ tab: undefined }), label: 'Все', count: found.length, current: status === undefined },
            ...invoiceStatuses.map((one) => ({
              href: href({ tab: one }),
              label: INVOICE_STATUS_LABELS[one],
              count: countByStatus(found, one),
              current: status === one,
            })),
          ]}
        />
        <form className="listbar__search" action="/invoices">
          {status ? <input type="hidden" name="tab" value={status} /> : undefined}
          <input type="hidden" name="code" value={code} />
          <input
            className="input"
            name="q"
            defaultValue={query}
            placeholder="Номер, назначение, покупатель"
            aria-label="Поиск по счетам"
          />
          <button type="submit" className="btn btn--ghost btn--tiny">
            Найти
          </button>
        </form>
        <Columns shown={shown} merchantId={actor.merchantId} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="card"
          title={all.length === 0 ? 'Счетов пока нет' : 'По этому отбору ничего нет'}
          text={
            all.length === 0
              ? 'Счёт выставляется в кассе: покупатель называет валюту и сумму, вы нажимаете «Выставить счёт».'
              : 'Снимите поиск или возьмите другое состояние.'
          }
        />
      ) : (
        <div className="scroll-x">
          <table className="datatable">
            <thead>
              <tr>
                {shown.map((column) => (
                  <th key={column} className={column === 'amount' || column === 'created' ? 'num' : undefined}>
                    {INVOICE_COLUMN_LABELS[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((one) => (
                <tr key={one.id}>
                  {shown.map((column) => {
                    const cell = invoiceCell(one, column);
                    return (
                      <td key={column} className={cell.numeric ? 'num' : undefined}>
                        {column === 'number' ? (
                          <Link href={`/invoices/${one.id}`}>{cell.text}</Link>
                        ) : column === 'status' ? (
                          <span className={`pill pill--${INVOICE_STATUS_TONES[one.status]}`}>
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
