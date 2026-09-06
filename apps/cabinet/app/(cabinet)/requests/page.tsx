import { HowTo, QuietRefresh, Tabs } from '@nemo/ui';
import { requireViewer } from '@/lib/auth';
import { getCore } from '@/lib/core';
import {
  pickTab,
  REQUESTS_PAGE,
  REQUEST_TABS,
  statusesOf,
  TAB_LABELS,
  toRequestRow,
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
  const { actor, session } = await requireViewer();
  const params = await searchParams;
  const tab = pickTab(single(params.tab));

  const core = getCore();
  const [rows, ...counts] = await Promise.all([
    core.listExchangeRequests(actor, {
      limit: REQUESTS_PAGE,
      ...withStatuses(tab),
    }),
    ...REQUEST_TABS.map((one) => core.countExchangeRequests(actor, withStatuses(one))),
  ]);

  const total = counts[REQUEST_TABS.indexOf(tab)] ?? 0;

  return (
    <main className="page page--wide">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Заявки</h1>
          <p className="page__sub">Всё, что подано из кабинета и по API.</p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Состояния, свой номер и отмена" items={HOW_TO} />

      <div className="filters">
        <Tabs
          label="Какие заявки показывать"
          items={REQUEST_TABS.map((one, index) => ({
            href: `/requests?tab=${one}`,
            label: TAB_LABELS[one],
            count: counts[index] ?? 0,
            current: one === tab,
          }))}
        />
      </div>

      <RequestsTable rows={rows.map(toRequestRow)} total={total} tab={tab} />
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
