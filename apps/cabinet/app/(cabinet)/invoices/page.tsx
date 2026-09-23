import { cookies } from 'next/headers';
import Link from 'next/link';
import { merchantRoleCan, Money, sortCurrencies } from '@nemo/types';
import { EmptyState, firstParam, HowTo, Icon, PeriodChips, Stat, Stats, Tabs } from '@nemo/ui';
import { formatMoney } from '@nemo/ui/format';
import { TZ_COOKIE, localMidnight, readTzOffset } from '@nemo/ui/period';
import { allowedHere } from '@/lib/access';
import { getCore } from '@/lib/core';
import {
  INVOICE_PERIOD_KEYS,
  applyInvoiceFilter,
  invoiceFilterParams,
  readInvoiceFilter,
} from '@/lib/invoice-filter';
import { INVOICE_PREFS_COOKIE, readInvoicePrefs } from '@/lib/invoice-prefs';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  countByStatus,
  dailySeries,
  invoiceCell,
  invoiceCurrencies,
  invoiceMarks,
  currencyBreakdown,
  invoiceStatuses,
  invoiceSummary,
  pageOf,
  paidOnly,
} from '@/lib/invoice-rows';
import { listInvoices, listRefunds } from '@/lib/mock/store';
import { payRounding } from '@/lib/pos';
import { isDeletable, isPayable } from '@/lib/pos/lifecycle';
import {
  INVOICE_TILE_LABELS,
  INVOICES_HOW_TO,
  INVOICES_NOTE,
  PREVIEW_NOTE,
} from '@/lib/pos-texts';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';
import { PosLive } from '@/app/ui/pos-live';
import { Spark } from '@/app/ui/spark';
import { CurrencyBreakdown } from './currency-breakdown';
import { CurrencySwitch } from './currency-switch';
import { InvoicesTable, type InvoiceRowView } from './invoices-table';

export const dynamic = 'force-dynamic';

/** Сколько суток ход на плитке показывает самое большее. */
const SPARK_DAYS = 60;
const DAY = 24 * 60 * 60_000;

/**
 * Счета POS-терминала: список с числами над ним — устройство взято у
 * образца Love&Pay (раздел «Счета»), слова — владельца (`pos-texts.ts`).
 *
 * Макет без денег — записи живут в памяти процесса и до перезапуска
 * (`backlog.md`), платёж принимает имитация провайдера. Сказано об
 * этом сверху: мерчант, потерявший счёт после выкатки, решит, что
 * сервис теряет деньги. Список перечитывает себя по событиям
 * терминала: оплата видна без перезагрузки.
 *
 * Отбор — поиск, период, «только мои» и таб — живёт в адресе и сужает
 * сам список на сервере; разбор адреса один с выгрузкой
 * (`invoice-filter.ts`). Плитки и счётчики табов считают тот же отбор,
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
  const filter = readInvoiceFilter((key) => firstParam(params[key]), now, offset);
  const { found, rows } = applyInvoiceFilter(all, filter, actor.userId ?? null);
  const page = pageOf(rows, Number(firstParam(params.page) ?? '1'), prefs.perPage);

  // Валюта сумм — из адреса: складывать баты с юанями нечем, и валюту
  // выбирает тот, кто смотрит. Выбирают из всех валют сервиса, а не
  // только встреченных в счетах: «оборот в юанях — ноль» тоже ответ.
  // Доля возврата в ней ровняется тем же знаком, что сумма к оплате.
  const terms = await getCore().getExchangeTerms();
  const codes = sortCurrencies([
    ...new Set([...terms.currencies.map((one) => one.code), ...invoiceCurrencies(all)]),
  ]);
  const code = codes.includes(firstParam(params.code) ?? '') ? firstParam(params.code)! : 'RUB';
  const currency = terms.currencies.find((one) => one.code === code);
  const summary = invoiceSummary(found, refunds, code, currency ? payRounding(currency) : 2);
  const returned = countByStatus(found, 'refunded');

  // Ход на плитках — не длиннее двух месяцев: без периода — с дня первого
  // счёта (полтора месяца нулей до него сжимали бы в угол всё, ради чего
  // линию рисуют), со своим периодом — последние два месяца в нём (адрес
  // «с 2000 по 2100 год» рисовал бы линию в сорок тысяч точек).
  const today = localMidnight(now, offset);
  const sparkTo = filter.picked?.period.to ?? new Date(today.getTime() + DAY);
  const oldest = found.at(-1);
  const sparkFrom = new Date(
    Math.max(
      sparkTo.getTime() - SPARK_DAYS * DAY,
      filter.picked
        ? filter.picked.period.from.getTime()
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

  const filterParams = invoiceFilterParams(filter);
  const withCode: Record<string, string> = {
    ...filterParams,
    ...(code === 'RUB' ? {} : { code }),
  };
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...withCode, ...over })) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `/invoices?${text}` : '/invoices';
  };
  const csvQuery = new URLSearchParams(filterParams).toString();
  const csvHref = csvQuery ? `/api/pos/invoices/csv?${csvQuery}` : '/api/pos/invoices/csv';
  // Период чипы кладут сами; остальное они переносят как есть.
  const { period: _period, from: _from, to: _to, ...keep } = withCode;

  const view: InvoiceRowView[] = page.rows.map((one) => {
    const marks = invoiceMarks(one, refunds);
    return {
      id: one.id,
      tone: INVOICE_STATUS_TONES[one.status],
      createdAt: one.createdAt,
      paidAt: one.paidAt,
      payable: isPayable(one, now),
      deletable: isDeletable(one),
      cells: Object.fromEntries(
        prefs.columns.map((column) => [column, invoiceCell(one, column, offset, marks)]),
      ),
    };
  });

  const narrowed = Boolean(filter.query) || filter.picked !== null || filter.mine;

  return (
    <main className="page page--wide">
      <PosLive />
      <DisabledBanner status={session.status} />

      {/*
        Шапка держит одно главное действие — «Создать счёт» — справа от
        заголовка, крупно и с плюсом: за ним сюда и приходят. Подпись под
        заголовком сужена, иначе длинное предупреждение о макете сталкивало
        кнопку под себя. Выгрузка — рядом, тише; настройка таблицы живёт у
        самой таблицы.
      */}
      <header className="page__head invoices__head">
        <div className="invoices__intro">
          <h1 className="page__title">Счета</h1>
          <p className="page__sub">
            {INVOICES_NOTE} {PREVIEW_NOTE}
          </p>
        </div>
        <div className="page__actions">
          {/* «CSV», как у остальных выгрузок кабинета и панели. */}
          <a className="btn btn--ghost" href={csvHref}>
            CSV
          </a>
          {/*
            Счёт создаётся в POS-терминале: там считается цена, и второй
            формы с той же ценой быть не должно. Слово кнопки — владельца
            («создать счёт»), а не образца.
          */}
          {merchantRoleCan(session.role, 'till') ? (
            <Link className="btn btn--gold invoices__create" href="/pos">
              <span className="invoices__plus" aria-hidden>
                <Icon name="plus" size={14} />
              </span>
              Создать счёт
            </Link>
          ) : undefined}
        </div>
      </header>

      <HowTo title="Как устроены счета" sub="Состояния, числа и выгрузка" items={INVOICES_HOW_TO} />

      {/*
        В какой валюте плитки считают суммы — одна пилюля над ними, а не
        ряд кнопок под ними: выбор стоит до чисел, которые от него зависят.
      */}
      <div className="invoices__sums">
        <span className="invoices__sums-label">Оборот в</span>
        <CurrencySwitch
          codes={codes}
          selected={code}
          hrefs={Object.fromEntries(
            codes.map((one) => [one, href({ code: one === 'RUB' ? undefined : one, page: undefined })]),
          )}
        />
      </div>

      <Stats>
        <Stat
          label={INVOICE_TILE_LABELS.total}
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
          label={INVOICE_TILE_LABELS.paid}
          value={summary.paid}
          note={
            <>
              {formatMoney(summary.paidSum, code)}
              {Money.isZero(summary.refunded) ? '' : ` · возвраты −${formatMoney(summary.refunded, code)}`}
              {/*
                Плитка считает все счета, за которые деньги приходили, и
                возвращённые тоже — иначе их возврат вычитался бы из
                оплаченного, которого на плитке нет. Таб «Оплачен» —
                только те, что оплачены сейчас, и разницу плитка называет.
              */}
              {returned > 0 ? ` · из них возвращены целиком: ${returned}` : ''}
              <Spark series={paidSeries} tone="up" />
            </>
          }
          tone={summary.paid > 0 ? 'up' : 'plain'}
        />
        <Stat
          label={INVOICE_TILE_LABELS.turnover(code)}
          value={formatMoney(summary.net, code)}
          note={
            summary.conversion === null
              ? 'оплачено минус возвраты'
              : `оплачено минус возвраты · конверсия ${summary.conversion} %`
          }
        />
        {/*
          Суммы по валютам — столбиком и со значком: строкой через точку
          «850 CNY · 13 900 THB · 150 USDT» крупным кеглем переносилась
          посреди суммы, и глаз искал, где кончается одна и начинается
          другая. Нажатие раскрывает все валюты сервиса.
        */}
        <Stat
          label="По валютам"
          value={
            <CurrencyBreakdown
              selected={code}
              lines={currencyBreakdown(found, codes).map((line) => ({
                code: line.code,
                amount: line.amount === null ? null : formatMoney(line.amount, line.code),
                count: line.count,
                href: href({ code: line.code === 'RUB' ? undefined : line.code, page: undefined }),
              }))}
            />
          }
          // Что получили покупатели по оплаченным счетам — в валюте
          // получения. Рубль и монета, которыми платят, здесь «—» не
          // потому, что оплат не было: их оборот — на соседней плитке.
          note="получили покупатели, без сложения между собой"
        />
      </Stats>

      <div className="listbar">
        <Tabs
          label="Состояния счетов"
          items={[
            {
              href: href({ tab: undefined, page: undefined }),
              label: 'Все',
              count: found.length,
              current: filter.status === undefined,
            },
            ...invoiceStatuses.map((one) => ({
              href: href({ tab: one, page: undefined }),
              label: INVOICE_STATUS_LABELS[one],
              count: countByStatus(found, one),
              current: filter.status === one,
            })),
          ]}
        />
        <form className="listbar__search" action="/invoices">
          {Object.entries(withCode).map(([key, value]) =>
            key === 'q' ? undefined : <input key={key} type="hidden" name={key} value={value} />,
          )}
          <input
            className="input"
            name="q"
            defaultValue={filter.query}
            placeholder="Номер счёта"
            aria-label="Поиск по счетам"
          />
          <button type="submit" className="btn btn--ghost btn--tiny">
            Найти
          </button>
        </form>
        {/*
          Счета всех сотрудников или только свои — по тому, кто нажал
          «Создать счёт», а не по имени. Похоже на переключатель, но это
          ссылка: отбор живёт в адресе, как поиск и период. Поэтому и роли
          `switch` у неё нет — переключатель обязан откликаться на пробел,
          а ссылка откликается только на Enter; что будет по нажатию,
          экранному диктору говорит подпись.
        */}
        <Link
          className={filter.mine ? 'switch' : 'switch switch--on'}
          href={href({ mine: filter.mine ? undefined : '1', page: undefined })}
          aria-label={
            filter.mine
              ? 'Показаны только ваши счета. Показать счета всех сотрудников'
              : 'Показаны счета всех сотрудников. Показать только ваши'
          }
          scroll={false}
        >
          <span className="switch__track" aria-hidden />
          Счета всех сотрудников
        </Link>
      </div>

      <PeriodChips
        current={filter.picked?.period.key ?? null}
        basePath="/invoices"
        from={filter.picked?.days.from ?? ''}
        to={filter.picked?.days.to ?? ''}
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
              : 'Снимите поиск, период или «только ваши» — или возьмите другое состояние.'
          }
        />
      ) : (
        <>
          <InvoicesTable
            rows={view}
            prefs={prefs}
            merchantId={actor.merchantId}
            exportHref={csvHref}
            canAct={merchantRoleCan(session.role, 'till')}
          />
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
