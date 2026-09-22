import { cookies } from 'next/headers';
import { PeriodChips, QuietRefresh, Stat, Stats } from '@nemo/ui';
import { TZ_COOKIE, readTzOffset } from '@nemo/ui/period';
import { getCore } from '@/lib/core';
import { countOf, requestCounts, viewer } from '@/lib/reads';
import {
  boundsOf,
  LIST_PERIOD_KEYS,
  pickPeriod,
  pickSearch,
  pickTab,
  REQUESTS_PAGE,
  REQUEST_TABS,
  statusesOf,
  tabHref,
  TAB_LABELS,
  TAB_NOTES,
  TAB_TONES,
  toRequestRow,
} from '@/lib/request-rows';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { RequestsSearch } from './requests-search';
import { RequestsTable } from './requests-table';

export const dynamic = 'force-dynamic';

/**
 * Заявки мерчанта: всё, что подала его интеграция по API.
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
  /*
   * Период — по часам того, кто смотрит: «с 1 по 10 сентября» в Бангкоке
   * начинается на семь часов раньше, чем на сервере. Смещение кладёт в
   * куку шапка, как и для обзора.
   */
  const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
  const picked = pickPeriod(
    { period: single(params.period), from: single(params.from), to: single(params.to) },
    new Date(),
    offset,
  );
  const bounds = boundsOf(picked);

  const core = getCore();
  const [rows, counts] = await Promise.all([
    core.listExchangeRequests(actor, {
      limit: REQUESTS_PAGE,
      ...withStatuses(tab),
      ...(search ? { search } : {}),
      ...bounds,
    }),
    // Числа на плитках считают то, что показано под ними, — найденное и
    // за выбранные даты: иначе над двумя строками стояло бы «Исполнены 10».
    requestCounts(search, bounds),
  ]);

  const total = countOf(counts, statusesOf(tab));

  return (
    <main className="page page--wide">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Заявки</h1>
          {/*
            Заявок за мерчанта сервис не заводит: подаёт их только его
            интеграция. До 21 сентября 2026 строка обещала ещё и
            «заведено менеджером» — такого пути нет, и колонка «Кто
            подал» под этой строкой отличала то, чего не бывает.
          */}
          <p className="page__sub">Всё, что подала ваша интеграция по API.</p>
        </div>
      </header>

      <div className="filters">
        <RequestsSearch query={search} period={picked?.query ?? {}} />
      </div>

      {/*
        Даты — те же чипы, что на обзоре, и те же слова на них: выборка
        «30 дней» там и здесь одна и та же. Своё у списка — «За всё
        время»: периода у него может не быть, и так он и открывается.
      */}
      <PeriodChips
        current={picked?.period.key ?? null}
        basePath="/requests"
        from={picked?.days.from ?? ''}
        to={picked?.days.to ?? ''}
        quick={LIST_PERIOD_KEYS}
        allTime="За всё время"
        keep={{ tab, ...(search ? { q: search } : {}) }}
      />

      {/*
        Плитками, как на обзоре, а не строкой табов: число за каждым
        состоянием здесь не подпись к кнопке, а то, зачем на неё смотрят,
        — «сколько в работе» читается раньше, чем «открыть в работе».
        Плитка при этом остаётся ссылкой, и выборку по-прежнему сужает
        сервер.
      */}
      <nav aria-label="Какие заявки показывать">
        <Stats>
          {REQUEST_TABS.map((one) => {
            const count = countOf(counts, statusesOf(one));
            return (
              <Stat
                key={one}
                label={TAB_LABELS[one]}
                value={count}
                note={noteOf(one, Boolean(search), picked !== null)}
                // Тон — только когда есть о чём: нулю он не нужен.
                tone={count > 0 ? TAB_TONES[one] : 'plain'}
                href={tabHref(one, search, picked?.query)}
                current={one === tab}
              />
            );
          })}
        </Stats>
      </nav>

      <RequestsTable
        rows={rows.map(toRequestRow)}
        total={total}
        tab={tab}
        search={search}
        period={picked?.query ?? {}}
      />
    </main>
  );
}

/**
 * Строка под числом плитки. Пока список не сужен, она говорит, что
 * посчитано; суженный — чем сужен: «Исполнены 2 · за выбранные даты»
 * честнее, чем «2 · деньги отправлены получателю» рядом с десятью на
 * обзоре.
 */
function noteOf(tab: ReturnType<typeof pickTab>, searched: boolean, dated: boolean): string {
  if (searched && dated) return 'из найденных за выбранные даты';
  if (searched) return 'из найденных';
  if (dated) return 'за выбранные даты';
  return TAB_NOTES[tab];
}

function withStatuses(tab: ReturnType<typeof pickTab>) {
  const statuses = statusesOf(tab);
  return statuses ? { statuses } : {};
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}
