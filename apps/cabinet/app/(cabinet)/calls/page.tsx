import Link from 'next/link';
import { API_LOG_METHODS } from '@nemo/types';
import { HowTo, QuietRefresh, Stat, Stats, Tabs } from '@nemo/ui';
import { allowedHere } from '@/lib/access';
import { getCore } from '@/lib/core';
import { CALLS_HOW_TO } from '@/lib/integration-texts';
import { viewer } from '@/lib/reads';
import {
  CALL_OUTCOMES,
  CALLS_PAGE,
  OUTCOME_LABELS,
  callFilterQuery,
  coreCallFilter,
  readCallFilter,
  toCallRow,
  type CallFilter,
} from '@/lib/call-rows';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';
import { CallsTable } from './calls-table';

export const dynamic = 'force-dynamic';

/**
 * Журнал вызовов: что система мерчанта спрашивала и что ей ответили.
 *
 * Отвечает на вопрос «почему у меня не работает» без поддержки: отказ
 * стоит строкой со словами, а плитки над таблицей говорят, было ли это
 * один раз или всё утро. Сужается исходом, ключом, методом и частью
 * пути — или идентификатором запроса из заголовка ответа, — и всё это
 * живёт в адресе: сужать выборку должен сервер. Строка открывает
 * карточку вызова. Хранится тридцать дней.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await allowedHere('/calls');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { actor, session } = await viewer();
  const params = await searchParams;
  const asked = readCallFilter((name) => single(params[name]));
  const core = getCore();

  // Ключ из адреса принимается, только если он свой: чужой
  // идентификатор в фильтре ничего не найдёт, но и подтверждать его
  // существование пустым списком незачем.
  const keys = await core.listApiKeys(actor);
  const filter: CallFilter = {
    ...asked,
    keyId: keys.some((one) => one.id === asked.keyId) ? asked.keyId : undefined,
  };

  const [rows, total, summary, kept] = await Promise.all([
    core.listApiRequestLog(actor, { limit: CALLS_PAGE, ...coreCallFilter(filter) }),
    core.countApiRequestLog(actor, coreCallFilter(filter)),
    core.summarizeApiRequestLog(actor, { since: new Date(Date.now() - DAY_MS) }),
    core.countApiRequestLog(actor),
  ]);

  const href = (next: Partial<CallFilter>) => {
    const tail = callFilterQuery({ ...filter, ...next }).toString();
    return tail ? `/calls?${tail}` : '/calls';
  };
  const narrowed = filter.method !== undefined || filter.search !== undefined;

  return (
    <main className="page page--wide">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Журнал вызовов</h1>
          <p className="page__sub">Вызовы API за тридцать дней: код, время, адрес, слова отказа.</p>
        </div>
      </header>

      <HowTo
        title="Как это устроено"
        sub="Что попадает в журнал и как читать код"
        items={CALLS_HOW_TO}
      />

      <Stats>
        <Stat label="Успешных за сутки" value={summary.ok} note={`из ${summary.total}`} />
        <Stat
          label="С ошибкой за сутки"
          value={summary.failed}
          tone={summary.failed > 0 ? 'wait' : 'plain'}
          note={summary.failed > 0 ? 'посмотрите слова отказа' : 'отказов не было'}
        />
        <Stat
          label="Среднее время ответа"
          value={summary.averageDurationMs === null ? '—' : `${summary.averageDurationMs} мс`}
          note="по всем ответам за сутки"
        />
        <Stat label="Всего записей" value={kept} note="в журнале" />
      </Stats>

      <div className="filters">
        <Tabs
          label="Какие вызовы показывать"
          items={CALL_OUTCOMES.map((one) => ({
            href: href({ outcome: one }),
            label: OUTCOME_LABELS[one],
            current: one === filter.outcome,
          }))}
        />
        {/*
         * Метод и поиск — обычной формой GET: отбор живёт в адресе и
         * работает без скрипта, а исход и ключ едут с ней скрытыми
         * полями, чтобы поиск их не сбрасывал.
         */}
        <form
          key={callFilterQuery(filter).toString()}
          className="calls-search"
          action="/calls"
          method="get"
          role="search"
        >
          {filter.outcome !== 'all' ? <input type="hidden" name="outcome" value={filter.outcome} /> : undefined}
          {filter.keyId ? <input type="hidden" name="key" value={filter.keyId} /> : undefined}
          <label className="filters__field">
            <span className="sr-only">Часть пути или идентификатор запроса</span>
            <input
              className="input"
              type="search"
              name="q"
              defaultValue={filter.search ?? ''}
              placeholder="Часть пути или x-request-id"
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            <span className="sr-only">Метод</span>
            <select className="input filters__pick" name="method" defaultValue={filter.method ?? ''}>
              <option value="">Любой метод</option>
              {API_LOG_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn--soft">
            Показать
          </button>
          {narrowed ? (
            <Link className="btn btn--ghost" href={href({ method: undefined, search: undefined })}>
              Сбросить
            </Link>
          ) : undefined}
        </form>
        {keys.length > 1 ? (
          <nav className="chips" aria-label="Каким ключом">
            <Link className={filter.keyId ? 'chip' : 'chip chip--on'} href={href({ keyId: undefined })}>
              Все ключи
            </Link>
            {keys.map((key) => (
              <Link
                key={key.id}
                className={key.id === filter.keyId ? 'chip chip--on' : 'chip'}
                href={href({ keyId: key.id })}
              >
                {key.label}
              </Link>
            ))}
          </nav>
        ) : undefined}
      </div>

      <CallsTable
        rows={rows.map(toCallRow)}
        total={total}
        query={callFilterQuery(filter).toString()}
        narrowed={narrowed || filter.outcome !== 'all' || filter.keyId !== undefined}
      />
    </main>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  const one = (Array.isArray(value) ? value[0] : value)?.trim();
  return one || undefined;
}
