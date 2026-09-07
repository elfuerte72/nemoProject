import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Brand, Sidebar, Topbar } from '@nemo/ui';
import { requireStaffViewerOrNull } from '@/lib/auth/require-session';
import { panelCounts } from '@/lib/counts';
import { ROLE_LABELS } from '@/lib/labels';
import { NAV_COLLAPSED_KEY, NAV_GROUPS } from '@/lib/nav';
import { TZ_COOKIE } from '@nemo/ui/period';
import { PaletteSearch } from '@/app/ui/palette-search';

export const dynamic = 'force-dynamic';

/**
 * Каркас рабочих разделов: меню слева, шапка сверху, раздел под ней.
 *
 * Экран входа сюда не попадает — он лежит вне этой группы: меню, из
 * которого некуда идти, и имя сотрудника, которого ещё не опознали, там
 * не нужны.
 *
 * Проверка сессии здесь не заменяет проверку на самих страницах:
 * каркас лишь решает, что показать вместо панели, а данные закрывают
 * операции ядра. Одна проверка на входе в каркас защищала бы разметку,
 * а не заявки.
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const viewer = await requireStaffViewerOrNull();
  if (!viewer) {
    redirect('/login');
  }
  const { actor, displayName } = viewer;

  /*
   * Счётчики очередей в меню: сколько ждёт, видно не открывая раздел —
   * ради этого они и нужны. Четыре запроса на каждый переход между
   * разделами — плата за это; очереди рассчитаны на десятки строк, и
   * отдельный запрос за одним числом стоил бы столько же. Стол читает
   * те же числа — из той же памяти запроса, а не заново.
   */
  const counts = await panelCounts(actor);

  return (
    <div className="shell">
      <Sidebar
        groups={NAV_GROUPS}
        counts={counts}
        storageKey={NAV_COLLAPSED_KEY}
        brand={<Brand eyebrow="панель" />}
        homeLabel="Tobee, панель — на рабочий стол"
      />
      <div className="shell__main">
        <Topbar
          search={<PaletteSearch />}
          name={displayName}
          sub={ROLE_LABELS[actor.role]}
          items={[{ href: '/settings', label: 'Настройки', icon: 'settings' }]}
          logoutPath="/api/auth/logout"
          afterLogout="/login"
          timeZoneCookie={TZ_COOKIE}
        />
        {children}
      </div>
    </div>
  );
}
