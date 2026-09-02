import { redirect } from 'next/navigation';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { HowToCards } from '@/app/ui/how-to';
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
    <main className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Заявки на карту</h1>
          {/*
            Про номер сказано здесь, а не подсказкой у поля: он уходит
            клиенту на экран карты, и узнавать об этом задним числом —
            после того, как в поле написано «для Пети», — поздно.
          */}
          <p className="page__sub">
            Состояние приходит от провайдера — панель только записывает то, что он сообщил. Номер
            заявки сохраняется вместе с состоянием и виден клиенту в приложении.
          </p>
        </div>
      </header>

      <HowToCards />

      <CardList
        fetchedAt={new Date().toISOString()}
        applications={applications.map((application) => ({
          ...application,
          clientId: application.clientId.toString(),
          createdAt: application.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
