import { redirect } from 'next/navigation';
import { REGULAR_CLIENT_COMPLETED } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { CLIENT_TAB_LABELS, clientTabs, pickTab, toClientRowDto } from '@/lib/client-rows';
import { getCore } from '@/lib/core';
import { HowTo } from '@/app/ui/howto';
import { Stat, Stats } from '@/app/ui/stat';
import { Tabs } from '@/app/ui/tabs';
import { ClientsSearch } from './clients-search';
import { ClientsTable } from './clients-table';

export const dynamic = 'force-dynamic';

/**
 * Клиенты: кто с нами работал, сколько раз и чем кончилось.
 *
 * Обеим ролям. Оборот — по валютам раздельно и только по исполненным;
 * «постоянный» — от трёх исполненных, это подсказка «с этим человеком
 * уже работали», а не уровень доверия.
 */

const HOW_TO = [
  {
    title: 'Откуда клиент',
    detail:
      'Запись появляется сама при первом открытии приложения. Ник — из Telegram, если он ' +
      'есть; без ника клиент виден по идентификатору.',
  },
  {
    title: 'Постоянный',
    detail:
      `Отметка от ${REGULAR_CLIENT_COMPLETED} исполненных заявок. Это не уровень доверия и не ` +
      'проверка личности — их у сервиса нет, — а подсказка «с этим человеком уже работали».',
  },
  {
    title: 'Оборот',
    detail:
      'Сколько клиент отдал по исполненным заявкам — по каждой валюте отдельно. Отменённые ' +
      'в оборот не входят: денег они не принесли.',
  },
  {
    title: 'Ждёт ответа',
    detail:
      'Последнее сообщение в переписке — от клиента, и никто ещё не ответил. Строка ' +
      'подсвечена, как заявка в очереди: это тоже работа.',
  },
];

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const params = await searchParams;
  const query = single(params.q);
  const tab = pickTab(single(params.tab));

  const core = getCore();
  const [summary, rows, total, ...counts] = await Promise.all([
    core.summarizeClients(actor),
    core.listClients(actor, { query, tab }),
    core.countClients(actor, { query, tab }),
    ...clientTabs.map((one) => core.countClients(actor, { query, tab: one })),
  ]);

  const suffix = query ? `&q=${encodeURIComponent(query)}` : '';

  return (
    <main className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Клиенты</h1>
          <p className="page__sub">
            Кто с нами работал, сколько раз и чем кончилось. Открыть — история заявок и переписка.
          </p>
        </div>
      </header>

      <HowTo title="Откуда берутся клиенты" sub="И что значат отметки" items={HOW_TO} />

      <Stats>
        <Stat label="Всего клиентов" value={summary.total} note="открывали приложение" />
        <Stat
          label="Постоянных"
          value={summary.regular}
          note={`от ${REGULAR_CLIENT_COMPLETED} исполненных заявок`}
          tone={summary.regular ? 'up' : 'plain'}
        />
        <Stat
          label="С открытой заявкой"
          value={summary.withOpen}
          note="в работе прямо сейчас"
          tone={summary.withOpen ? 'wait' : 'plain'}
        />
        <Stat
          label="Ждут ответа"
          value={summary.waiting}
          note={summary.waiting ? 'последнее слово за нами' : 'все отвечены'}
          tone={summary.waiting ? 'wait' : 'plain'}
          href="/conversations"
        />
      </Stats>

      <div className="filters">
        <ClientsSearch query={query} />
        <Tabs
          label="Кого показывать"
          items={clientTabs.map((one, index) => ({
            href: `/clients?tab=${one}${suffix}`,
            label: CLIENT_TAB_LABELS[one],
            count: counts[index] ?? 0,
            current: tab === one,
          }))}
        />
      </div>

      <ClientsTable
        key={`${tab}|${query}`}
        rows={rows.map(toClientRowDto)}
        total={total}
        query={query}
        tab={tab}
      />
    </main>
  );
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}
