import { redirect } from 'next/navigation';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { WithdrawalList } from './withdrawal-list';

export const dynamic = 'force-dynamic';

/**
 * Очередь выплат по бонусным баллам.
 *
 * Выплату исполняет менеджер вручную — автоматических переводов в этой
 * фазе нет. Отметка о выплате списывает баллы, поэтому она делается
 * после самого перевода, а не до.
 */
export default async function WithdrawalsPage() {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const requests = await getCore().listWithdrawalQueue(actor);

  return (
    <main style={styles.page}>
      <h1 style={styles.heading}>Заявки на вывод — {requests.length}</h1>
      {/*
        `clientId` — bigint, и в клиентский компонент он не переезжает:
        сериализация серверных компонентов его не переносит.
      */}
      <WithdrawalList
        requests={requests.map((request) => ({
          ...request,
          clientId: request.clientId.toString(),
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
