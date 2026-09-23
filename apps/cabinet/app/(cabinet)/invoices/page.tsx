import { cookies } from 'next/headers';
import Link from 'next/link';
import { merchantRoleCan, Money } from '@nemo/types';
import { EmptyState, firstParam, HowTo, PeriodChips, Stat, Stats, Tabs } from '@nemo/ui';
import { formatMoney } from '@nemo/ui/format';
import { formatByCurrency } from '@nemo/ui/money-list';
import { TZ_COOKIE, localMidnight, readTzOffset, type PeriodKey } from '@nemo/ui/period';
import { allowedHere } from '@/lib/access';
import { INVOICE_PREFS_COOKIE, readInvoicePrefs } from '@/lib/invoice-prefs';
import {
  INVOICE_STATUS_TONES,
  INVOICE_TAB_LABELS,
  countByStatus,
  dailySeries,
  invoiceCell,
  invoiceCurrencies,
  invoiceMarks,
  invoiceMoneyLines,
  invoiceStatuses,
  invoiceSummary,
  narrowInvoices,
  pageOf,
  paidOnly,
  type InvoiceStatus,
} from '@/lib/invoice-rows';
import { listInvoices, listRefunds } from '@/lib/mock/store';
import { INVOICES_HOW_TO, INVOICES_NOTE, PREVIEW_NOTE } from '@/lib/pos-texts';
import { pickPeriod } from '@/lib/request-rows';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';
import { PosLive } from '@/app/ui/pos-live';
import { Spark } from '@/app/ui/spark';
import { Columns } from './columns';
import { InvoicesTable, type InvoiceRowView } from './invoices-table';

export const dynamic = 'force-dynamic';

/** Чипы периода: смена, неделя, месяц — и «за всё время» первым. */
const INVOICE_PERIOD_KEYS: readonly PeriodKey[] = ['today', '7d', '30d'];

/** Сколько суток ход на плитке показывает без выбранного периода. */
const SPARK_DAYS = 60;
const DAY = 24 * 60 * 60_000;

/**
 * Счета POS-терминала: список с числами над ним — устройство взято у
 * образца Love&Pay (раздел «Счета»), слова — владельца.
 *
 * Макет без денег — записи живут в памяти процесса и до перезапуска
 * (`backlog.md`), платёж принимает имитация провайдера. Сказано об
 * этом сверху: мерчант, потерявший счёт после выкатки, решит, что
 * сервис теряет деньги. Список перечитывает себя по событиям
 * терминала: оплата видна без перезагрузки.
 *
 * Отбор — поиск, период, «только мои» и таб — живёт в адресе и сужает
 * сам список на сервере. Плитки и счётчики табов считают тот же отбор,
 * но без таба: таб выбирает строки, а не меняет итоги. Страницу режет
 * сервер по числу строк из «Полей».
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await allowedHere('/invoices');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { actor, session } = await viewer();
  const params = await searchParams;
  const jar = await cookies();
  const prefs = readInvoicePrefs(jar.get(INVOICE_PREFS_COOKIE)?.value, actor.merchantId);
  const offset = readTzOffset(jar.get(TZ_COOKIE)?.value);
  const now = new Date();

  const all = listInvoices(actor.merchantId, now);
  const refunds = listRefunds(actor.merchantId);
  const query = firstParam(params.q)?.trim() ?? '';
  const tab = firstParam(params.tab);
  const status = (invoiceStatuses as readonly string[]).includes(tab ?? '')
    ? (tab as InvoiceStatus)
    : undefined;
  const mine = firstParam(params.mine) === '1';
  const picked = pickPeriod(
    { period: firstParam(params.period), from: firstParam(params.from), to: firstParam(params.to) },
    now,
    offset,
    INVOICE_PERIOD_KEYS,
  );

  const found = narrowInvoices(all, {
    query,
    from: picked?.period.from,
    to: picked?.period.to,
    authorId: mine ? (actor.userId ?? undefined) : undefined,
  });
  const rows = status === undefined ? found : found.filter((one) => one.status === status);
  const page = pageOf(rows, Number(firstParam(params.page) ?? '1'), prefs.perPage);

  // Валюта сумм — из адреса: складывать баты с юанями нечем, и валюту
  // выбирает тот, кто смотрит.
  const codes = invoiceCurrencies(all);
  const code = codes.includes(firstParam(params.code) ?? '') ? firstParam(params.code)! : 'RUB';
  const summary = invoiceSummary(found, refunds, code);
  const returned = countByStatus(found, 'refunded');

  // Ход на плитках — по дням выбранного периода, а без него — с дня
  // первого счёта, но не дальше двух месяцев: «всё время» линией в
  // тысячу точек не читается, а полтора месяца нулей до первого счёта
  // сжимают в угол всё, ради чего линию и рисуют.
  const today = localMidnight(now, offset);
  // Свой период тоже не длиннее двух месяцев — последних в нём: адрес
  // «с 2000 по 2100 год» иначе рисовал бы линию в сорок тысяч точек.
  const sparkTo = picked?.period.to ?? new Date(today.getTime() + DAY);
  const oldest = found.at(-1);
  const sparkFrom = new Date(
    Math.max(
      sparkTo.getTime() - SPARK_DAYS * DAY,
      picked
        ? picked.period.from.getTime()
        : oldest
          ? localMidnight(new Date(oldest.createdAt), offset).getTime()
          : 0,
    ),
  );
  const issuedSeries = dailySeries(found.map((one) => one.createdAt), sparkFrom, sparkTo);
  const paidSeries = dailySeries(
    paidOnly(found).flatMap((one) => (one.paidAt ? [one.paidAt] : [])),
    sparkFrom,
    sparkTo,
  );

  const filters: Record<string, string | undefined> = {
    q: query || undefined,
    tab: status,
    code: code === 'RUB' ? undefined : code,
    mine: mine ? '1' : undefined,
    ...(picked?.query ?? {}),
  };
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, ...over })) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `/invoices?${text}` : '/invoices';
  };
  const csvHref = (() => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value && key !== 'code') next.set(key, value);
    }
    const text = next.toString();
    return text ? `/api/pos/invoices/csv?${text}` : '/api/pos/invoices/csv';
  })();
  // Период и таб чипы кладут сами; остальное они переносят как есть.
  const keep: Record<string, string> = {};
  for (const [key, value] of Object.entries({ q: filters.q, tab: filters.tab, code: filters.code, mine: filters.mine })) {
    if (value) keep[key] = value;
  }

  const view: InvoiceRowView[] = page.rows.map((one) => {
    const marks = invoiceMarks(one, refunds);
    return {
      id: one.id,
      tone: INVOICE_STATUS_TONES[one.status],
      createdAt: one.createdAt,
      paidAt: one.paidAt,
      cells: Object.fromEntries(
        prefs.columns.map((column) => [column, invoiceCell(one, column, offset, marks)]),
      ),
    };
  });

  const narrowed = Boolean(query) || picked !== null || mine;

  return (
    <main className="page page--wide">
      <PosLive />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Счета</h1>
          <p className="page__sub">
            {INVOICES_NOTE} {PREVIEW_NOTE}
          </p>
        </div>
        <div className="page__actions">
          <Columns prefs={prefs} merchantId={actor.merchantId} />
          <a className="btn btn--ghost btn--tiny" href={csvHref}>
            Выгрузить
          </a>
          {/*
            Счёт создаётся в POS-терминале: там считается цена, и второй
            формы с той же ценой быть не должно. Слово кнопки — владельца
            («создать счёт»), а не образца.
          */}
          {merchantRoleCan(session.role, 'till') ? (
            <Link className="btn btn--gold btn--tiny" href="/pos">
              Создать счёт
            </Link>
          ) : undefined}
        </div>
      </header>

      <HowTo title="Как устроены счета" sub="Состояния, числа и выгрузка" items={INVOICES_HOW_TO} />

      <Stats>
        <Stat
          label="Всего счетов"
          value={summary.count}
          note={
            <>
              {formatMoney(summary.sum, code)}
              {narrowed ? ' · по отбору' : ''}
              <Spark series={issuedSeries} />
            </>
          }
        />
        <Stat
          label="Ожидают"
          value={summary.pending}
          note={summary.pending === 0 ? 'все обработаны' : formatMoney(summary.pendingSum, code)}
          tone={summary.pending > 0 ? 'wait' : 'plain'}
        />
        <Stat
          label="Оплачено"
          value={summary.paid}
          note={
            <>
              {formatMoney(summary.paidSum, code)}
              {Money.isZero(summary.refunded) ? '' : ` · возвраты −${formatMoney(summary.refunded, code)}`}
              {/*
                Плитка считает все счета, за которые деньги приходили, и
                возвращённые тоже — иначе их возврат вычитался бы из
                оплаченного, которого на плитке нет. Таб «Оплачены» —
                только те, что оплачены сейчас, и разницу плитка называет.
              */}
              {returned > 0 ? ` · из них возвращены целиком: ${returned}` : ''}
              <Spark series={paidSeries} tone="up" />
            </>
          }
          tone={summary.paid > 0 ? 'up' : 'plain'}
        />
        <Stat
          label="Чистый оборот"
          value={formatMoney(summary.net, code)}
          note={
            summary.conversion === null
              ? 'оплачено минус возвраты'
              : `оплачено минус возвраты · конверсия ${summary.conversion} %`
          }
        />
        <Stat
          label="По валютам"
          value={formatByCurrency(invoiceMoneyLines(found))}
          note="оплаченные, без сложения между собой"
        />
      </Stats>

      {codes.length > 1 ? (
        <div className="chips">
          {codes.map((one) => (
            <Link
              key={one}
              href={href({ code: one === 'RUB' ? undefined : one, page: undefined })}
              className={one === code ? 'chip chip--on' : 'chip'}
              scroll={false}
            >
              Суммы в {one}
            </Link>
          ))}
        </div>
      ) : undefined}

      <div className="listbar">
        <Tabs
          label="Состояния счетов"
          items={[
            { href: href({ tab: undefined, page: undefined }), label: 'Все', count: found.length, current: status === undefined },
            ...invoiceStatuses.map((one) => ({
              href: href({ tab: one, page: undefined }),
              label: INVOICE_TAB_LABELS[one],
              count: countByStatus(found, one),
              current: status === one,
            })),
          ]}
        />
        <form className="listbar__search" action="/invoices">
          {Object.entries({ ...filters, q: undefined }).map(([key, value]) =>
            value ? <input key={key} type="hidden" name={key} value={value} /> : undefined,
          )}
          <input
            className="input"
            name="q"
            defaultValue={query}
            placeholder="Номер счёта"
            aria-label="Поиск по счетам"
          />
          <button type="submit" className="btn btn--ghost btn--tiny">
            Найти
          </button>
        </form>
        {/*
          «Счета всей команды» — как у образца: включено по умолчанию,
          выключенное оставляет счета того, кто смотрит. Отбор по тому,
          кто нажал «Создать счёт», а не по имени.
        */}
        <Link
          className={mine ? 'switch' : 'switch switch--on'}
          href={href({ mine: mine ? undefined : '1', page: undefined })}
          role="switch"
          aria-checked={!mine}
          scroll={false}
        >
          <span className="switch__track" aria-hidden />
          Счета всей команды
        </Link>
      </div>

      <PeriodChips
        current={picked?.period.key ?? null}
        basePath="/invoices"
        from={picked?.days.from ?? ''}
        to={picked?.days.to ?? ''}
        quick={INVOICE_PERIOD_KEYS}
        allTime="За всё время"
        keep={keep}
      />

      {page.total === 0 ? (
        <EmptyState
          icon="card"
          title={all.length === 0 ? 'Счетов пока нет' : 'По этому отбору ничего нет'}
          text={
            all.length === 0
              ? 'Счёт создаётся в POS-терминале: покупатель называет валюту и сумму, вы нажимаете «Создать счёт».'
              : 'Снимите поиск, период или «только мои» — или возьмите другое состояние.'
          }
        />
      ) : (
        <>
          <InvoicesTable rows={view} columns={prefs.columns} dense={prefs.dense} exportHref={csvHref} />
          <div className="table__foot">
            <span>
              {page.first}–{page.last} из {page.total}
            </span>
            {page.pages > 1 ? (
              <nav className="table__foot-actions" aria-label="Страницы списка">
                {page.page > 1 ? (
                  <Link className="btn btn--ghost btn--tiny" href={href({ page: String(page.page - 1) })} scroll={false}>
                    Назад
                  </Link>
                ) : undefined}
                <span>
                  {page.page} / {page.pages}
                </span>
                {page.page < page.pages ? (
                  <Link className="btn btn--ghost btn--tiny" href={href({ page: String(page.page + 1) })} scroll={false}>
                    Вперёд
                  </Link>
                ) : undefined}
              </nav>
            ) : undefined}
          </div>
        </>
      )}
    </main>
  );
}
