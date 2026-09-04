import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { SettingsNav } from './settings-nav';

/**
 * Каркас настроек: заголовок, подменю, подраздел под ним.
 *
 * Менеджеру каркас показывает отказ вместо подменю: шесть табов, каждый
 * из которых ведёт к тому же отказу, — мёртвая навигация. Но это
 * видимость, а не разграничение доступа: данные закрывают операции
 * ядра на каждой странице, и они отказывают не-администратору сами —
 * иначе один отказ в каркасе защищал бы заголовок, а не настройки.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Настройки</h1>
          <p className="page__sub">
            Экономика сервиса, справочники и сотрудники. Изменения действуют вперёд и
            попадают в журнал.
          </p>
        </div>
        {actor.role === 'admin' ? <SettingsNav /> : undefined}
      </header>
      {actor.role === 'admin' ? (
        children
      ) : (
        <p className="empty">
          Раздел доступен только администратору: здесь задаются ставки, наценка и доступ
          сотрудников. Если он нужен вам по работе — попросите администратора.
        </p>
      )}
    </main>
  );
}
