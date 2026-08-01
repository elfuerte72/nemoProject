import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ManagerExchangeRequestView } from '@nemo/core';
import { isAuthRefusal, requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { KIND_LABELS, STATUS_LABELS } from '@/lib/exchange-request-labels';

export const dynamic = 'force-dynamic';

/**
 * Рабочий стол менеджера: очередь и то, что уже в работе.
 *
 * Очередь общая и видна всем — так менеджеры понимают объём работы. Кто
 * какую заявку ведёт, видно из второго списка: параллельная работа над
 * одной заявкой — это два звонка клиенту и два разных курса.
 */
export default async function DeskPage() {
  const actor = await requireStaffActor().catch((error: unknown) => {
    if (isAuthRefusal(error)) return undefined;
    throw error;
  });
  if (!actor) {
    redirect('/login');
  }

  const core = getCore();
  const [queue, inProgress] = await Promise.all([
    core.listExchangeRequestQueue(actor),
    core.listExchangeRequestsInProgress(actor),
  ]);

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.heading}>Заявки на обмен</h1>
        <span style={styles.muted}>
          {actor.role === 'admin' ? 'Администратор' : 'Менеджер'}
        </span>
      </header>

      <section>
        <h2 style={styles.subheading}>Очередь — {queue.length}</h2>
        <ExchangeRequestList requests={queue} empty="Новых заявок нет." />
      </section>

      <section>
        <h2 style={styles.subheading}>В работе — {inProgress.length}</h2>
        <ExchangeRequestList requests={inProgress} empty="Ничего не в работе." />
      </section>
    </main>
  );
}

function ExchangeRequestList({
  requests,
  empty,
}: {
  requests: readonly ManagerExchangeRequestView[];
  empty: string;
}) {
  if (requests.length === 0) {
    return <p style={styles.muted}>{empty}</p>;
  }

  return (
    <ul style={styles.list}>
      {requests.map((request) => (
        <li key={request.id} style={styles.item}>
          <Link href={`/exchange-requests/${request.id}`} style={styles.link}>
            {request.fromAmount} {request.fromCode} → {request.toCode}
          </Link>
          <div style={styles.muted}>
            {STATUS_LABELS[request.status]} ·{' '}
            {KIND_LABELS[request.kind]} · клиент{' '}
            {request.clientId.toString()}
          </div>
        </li>
      ))}
    </ul>
  );
}

const styles = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    padding: '2rem 1.5rem',
    maxWidth: 720,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  heading: { fontSize: '1.35rem' },
  subheading: { fontSize: '1rem', marginBottom: '0.75rem' },
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '1rem' },
  item: { borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: '0.7rem' },
  link: { fontSize: '1rem', fontWeight: 600, color: 'inherit' },
  muted: { opacity: 0.7, fontSize: '0.85rem' },
} satisfies Record<string, React.CSSProperties>;
