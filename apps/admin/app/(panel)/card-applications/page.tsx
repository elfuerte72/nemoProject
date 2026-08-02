import { redirect } from 'next/navigation';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { CardList } from './card-list';

export const dynamic = 'force-dynamic';

/**
 * Заявки на виртуальную карту.
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
    <main className="page page--narrow">
      <header className="page__head">
        <div>
          <h1 className="page__title">Заявки на карту</h1>
          <p className="page__sub">
            Состояние приходит от провайдера — панель только записывает то, что он сообщил.
          </p>
        </div>
        <span className="section__count">{applications.length}</span>
      </header>

      <CardList
        applications={applications.map((application) => ({
          ...application,
          clientId: application.clientId.toString(),
        }))}
      />
    </main>
  );
}
