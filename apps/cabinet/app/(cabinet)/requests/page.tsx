import { QuietRefresh, Tabs } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { countOf, requestCounts, viewer } from '@/lib/reads';
import {
  pickSearch,
  pickTab,
  REQUESTS_PAGE,
  REQUEST_TABS,
  statusesOf,
  tabHref,
  TAB_LABELS,
  toRequestRow,
} from '@/lib/request-rows';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { RequestsSearch } from './requests-search';
import { RequestsTable } from './requests-table';

export const dynamic = 'force-dynamic';

/**
 * Заявки мерчанта: всё, что он подал — из кабинета и по API.
 *
 * Таб живёт в адресе, а не в разметке: сужать выборку должен сервер,
 * иначе «таб» означал бы, что приехало всё, а часть спрятана. Первая
 * страница приходит с сервером, хвост дочитывается по курсору — паре
 * «время подачи и идентификатор»: одно время теряет или дублирует
 * заявки, поданные в одну миллисекунду, а по API их подают пачкой.
 *
 * Поиск живёт там же, в адресе, и по той же причине. Приходят сюда чаще
 * всего за одной заявкой — «заказ 1013, где деньги», — поэтому поле
 * стоит первым, над табами.
 */

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, session } = await viewer();
  const params = await searchParams;
  const tab = pickTab(single(params.tab));
  const search = pickSearch(single(params.q));

  const core = getCore();
  const [rows, counts, people] = await Promise.all([
    core.listExchangeRequests(actor, {
      limit: REQUESTS_PAGE,
      ...withStatuses(tab),
      ...(search ? { search } : {}),
    }),
    // Числа на табах считают найденное, а не всё: иначе над двумя
    // строками стояло бы «Исполнены 10».
    requestCounts(search),
    // Состав кабинета читает один владелец (тикет 17): с именами
    // приходит и колонка «Кто подал», без них её нет вовсе.
    session.role === 'owner' ? core.listMerchantUsers(actor) : Promise.resolve(undefined),
  ]);

  const total = countOf(counts, statusesOf(tab));

  return (
    <main className="page page--wide">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Заявки</h1>
          <p className="page__sub">Всё, что подано по API и заведено менеджером.</p>
        </div>
      </header>

      <div className="filters">
        <RequestsSearch query={search} />
      </div>

      <div className="filters">
        <Tabs
          label="Какие заявки показывать"
          items={REQUEST_TABS.map((one) => ({
            href: tabHref(one, search),
            label: TAB_LABELS[one],
            count: countOf(counts, statusesOf(one)),
            current: one === tab,
          }))}
        />
      </div>

      <RequestsTable
        rows={rows.map(toRequestRow)}
        total={total}
        tab={tab}
        search={search}
        {...(people === undefined
          ? {}
          : { names: Object.fromEntries(people.map((one) => [one.id, one.name])) })}
      />
    </main>
  );
}

function withStatuses(tab: ReturnType<typeof pickTab>) {
  const statuses = statusesOf(tab);
  return statuses ? { statuses } : {};
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}
