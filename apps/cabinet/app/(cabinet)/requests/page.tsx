import { HowTo, QuietRefresh, Tabs } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { countOf, requestCounts, viewer } from '@/lib/reads';
import {
  pickTab,
  pickWho,
  REQUESTS_PAGE,
  REQUEST_TABS,
  statusesOf,
  submittedByFilter,
  TAB_LABELS,
  toRequestRow,
  WHO_KEYS,
  WHO_LABELS,
} from '@/lib/request-rows';
import { DisabledBanner } from '@/app/ui/disabled-banner';
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
 */

const HOW_TO = [
  {
    title: 'Что значит состояние',
    detail:
      '«Новая» — ждёт менеджера. «Курс подтверждён» — ждёт вас: реквизиты выданы, и на ' +
      'оплату есть срок. «Оплата получена» — деньги у нас, отправляем получателю.',
  },
  {
    title: 'Свой номер сделки',
    detail:
      'Ваш номер — бронь, счёт, заказ — виден менеджеру рядом с заявкой. По нему вы ' +
      'говорите с ним об одной и той же сделке, не сверяя два номера.',
  },
  {
    title: 'Отмена',
    detail:
      'Пока заявку не взяли в работу, отменить её можно самому. Дальше — только через ' +
      'менеджера: с этого момента по заявке уже могли уйти деньги.',
  },
  {
    title: 'Курс держится до конца срока оплаты',
    detail:
      'Курс называется при подаче и не меняется. Неоплаченную в срок заявку сервис ' +
      'отменяет — подать её можно заново, уже по новому курсу.',
  },
];

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, session } = await viewer();
  const params = await searchParams;
  const tab = pickTab(single(params.tab));
  const who = pickWho(single(params.who));
  const mine = submittedByFilter(who, session.userId);

  const core = getCore();
  const [rows, counts, people] = await Promise.all([
    core.listExchangeRequests(actor, {
      limit: REQUESTS_PAGE,
      ...withStatuses(tab),
      ...mine,
    }),
    requestCounts(),
    // Состав кабинета читает один владелец (тикет 17): с именами
    // приходит и колонка «Кто подал», без них её нет вовсе.
    session.role === 'owner' ? core.listMerchantUsers(actor) : Promise.resolve(undefined),
  ]);

  /*
   * Счётчик под фильтром считает то же, что показано: при «моих»
   * общее число заявок кабинета означало бы, что кнопка дочитывания
   * обещает строки, которых в этой выборке нет.
   */
  const total =
    who === 'all'
      ? countOf(counts, statusesOf(tab))
      : await core.countExchangeRequests(actor, { ...withStatuses(tab), ...mine });

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

      <HowTo title="Как это устроено" sub="Состояния, свой номер и отмена" items={HOW_TO} />

      <div className="filters">
        <Tabs
          label="Какие заявки показывать"
          items={REQUEST_TABS.map((one) => ({
            href: `/requests?tab=${one}${who === 'all' ? '' : `&who=${who}`}`,
            label: TAB_LABELS[one],
            count: countOf(counts, statusesOf(one)),
            current: one === tab,
          }))}
        />
        {/*
          * Чьи заявки — вторым рядом, а не пятым табом: это другой
          * вопрос к тому же списку, и слитый с состояниями он читался
          * бы как ещё одно состояние. Счётчика у него нет: под «моими»
          * он повторял бы число, которое стоит в подвале таблицы.
          */}
        <Tabs
          label="Чьи заявки показывать"
          items={WHO_KEYS.map((one) => ({
            href: `/requests?tab=${tab}${one === 'all' ? '' : `&who=${one}`}`,
            label: WHO_LABELS[one],
            current: one === who,
          }))}
        />
      </div>

      <RequestsTable
        rows={rows.map(toRequestRow)}
        total={total}
        tab={tab}
        who={who}
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
