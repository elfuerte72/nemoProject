import Link from 'next/link';
import { HowTo, QuietRefresh, Stat, Stats, Tabs } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { CALLS_HOW_TO } from '@/lib/integration-texts';
import { viewer } from '@/lib/reads';
import {
  CALL_OUTCOMES,
  CALLS_PAGE,
  OUTCOME_LABELS,
  pickOutcome,
  toCallRow,
} from '@/lib/call-rows';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { CallsTable } from './calls-table';

export const dynamic = 'force-dynamic';

/**
 * Журнал вызовов: что система мерчанта спрашивала и что ей ответили.
 *
 * Отвечает на вопрос «почему у меня не работает» без поддержки: отказ
 * стоит строкой со словами, а плитки над таблицей говорят, было ли это
 * один раз или всё утро. Сужается исходом и ключом, и оба живут в
 * адресе: сужать выборку должен сервер. Хранится тридцать дней.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, session } = await viewer();
  const params = await searchParams;
  const outcome = pickOutcome(single(params.outcome));
  const core = getCore();

  // Ключ из адреса принимается, только если он свой: чужой
  // идентификатор в фильтре ничего не найдёт, но и подтверждать его
  // существование пустым списком незачем.
  const keys = await core.listApiKeys(actor);
  const wanted = single(params.key);
  const keyId = keys.some((one) => one.id === wanted) ? wanted : undefined;

  const filter = {
    ...(outcome === 'all' ? {} : { outcome }),
    ...(keyId ? { keyId } : {}),
  };
  const [rows, total, summary] = await Promise.all([
    core.listApiRequestLog(actor, { limit: CALLS_PAGE, ...filter }),
    core.countApiRequestLog(actor, filter),
    core.summarizeApiRequestLog(actor, { since: new Date(Date.now() - DAY_MS) }),
  ]);

  const href = (next: { outcome?: string; key?: string | undefined }) => {
    const query = new URLSearchParams();
    const o = next.outcome ?? outcome;
    const k = 'key' in next ? next.key : keyId;
    if (o !== 'all') query.set('outcome', o);
    if (k) query.set('key', k);
    const tail = query.toString();
    return tail ? `/calls?${tail}` : '/calls';
  };

  return (
    <main className="page page--wide">
      <QuietRefresh />
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Журнал вызовов</h1>
          <p className="page__sub">Вызовы API за тридцать дней: код, время, слова отказа.</p>
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
      </Stats>

      <div className="filters">
        <Tabs
          label="Какие вызовы показывать"
          items={CALL_OUTCOMES.map((one) => ({
            href: href({ outcome: one }),
            label: OUTCOME_LABELS[one],
            current: one === outcome,
          }))}
        />
        {keys.length > 1 ? (
          <nav className="chips" aria-label="Каким ключом">
            <Link className={keyId ? 'chip' : 'chip chip--on'} href={href({ key: undefined })}>
              Все ключи
            </Link>
            {keys.map((key) => (
              <Link
                key={key.id}
                className={key.id === keyId ? 'chip chip--on' : 'chip'}
                href={href({ key: key.id })}
              >
                {key.label}
              </Link>
            ))}
          </nav>
        ) : undefined}
      </div>

      <CallsTable rows={rows.map(toCallRow)} total={total} outcome={outcome} keyId={keyId} />
    </main>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  const one = (Array.isArray(value) ? value[0] : value)?.trim();
  return one || undefined;
}
