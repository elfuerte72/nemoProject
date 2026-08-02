import { redirect } from 'next/navigation';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { CardList } from './card-list';

export const dynamic = 'force-dynamic';

/**
 * Заявки на европейскую карту.
 *
 * Сервис карту не выпускает, её данных не хранит и операций по ней не
 * проводит (docs/adr/0004) — здесь ведётся только состояние заявки,
 * поданной внешнему провайдеру.
 */
export default async function CardApplicationsPage() {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const applications = await getCore().listCardApplicationQueue(actor);

  return (
    <main style={styles.page}>
      <h1 style={styles.heading}>Заявки на карту — {applications.length}</h1>
      <CardList
        applications={applications.map((application) => ({
          ...application,
          clientId: application.clientId.toString(),
        }))}
      />
    </main>
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
    gap: '1.5rem',
  },
  heading: { fontSize: '1.3rem' },
} satisfies Record<string, React.CSSProperties>;
