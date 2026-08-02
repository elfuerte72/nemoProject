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
    <main className="page page--narrow">
      <header className="page__head">
        <div>
          <h1 className="page__title">Заявки на вывод</h1>
          <p className="page__sub">
            Баллы списываются отметкой о выплате — ставьте её после перевода, а не до.
          </p>
        </div>
        <span className="section__count">{requests.length}</span>
      </header>

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
