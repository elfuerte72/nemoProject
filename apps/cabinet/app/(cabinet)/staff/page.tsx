import { HowTo } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { viewer } from '@/lib/reads';
import { STAFF_HOW_TO } from '@/lib/staff-texts';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { StaffList } from './staff-list';

export const dynamic = 'force-dynamic';

/**
 * Раздел «Сотрудники»: кто входит в кабинет и что ему можно (тикет 17).
 *
 * Виден владельцу — и пункта меню у прочих нет, — но право проверяет
 * операция: спрятанный раздел обходится прямым запросом к маршруту, а
 * ядро отвечает одинаково на любой путь.
 *
 * Себя владелец видит в списке первым и без кнопок: роль ему не
 * меняется, доступ не закрывается, а пароль он меняет в настройках, где
 * спрашивают нынешний.
 */
export default async function StaffPage() {
  const { actor, session } = await viewer();
  const people = await getCore().listMerchantUsers(actor);

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Сотрудники</h1>
          <p className="page__sub">Кто входит в кабинет и что ему можно.</p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Роли, пароли, доступ" items={STAFF_HOW_TO} />

      <StaffList
        people={people.map((one) => ({
          id: one.id,
          email: one.email,
          name: one.name,
          role: one.role,
          disabledAt: one.disabledAt?.toISOString() ?? null,
          createdAt: one.createdAt.toISOString(),
        }))}
        meId={session.userId}
      />
    </main>
  );
}
