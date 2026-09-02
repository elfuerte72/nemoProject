import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireStaffViewerOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { Sidebar } from '@/app/ui/sidebar';
import { Topbar } from '@/app/ui/topbar';

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

  const core = getCore();
  /*
   * Счётчики очередей в меню: сколько ждёт, видно не открывая раздел —
   * ради этого они и нужны. Три запроса на каждый переход между
   * разделами — плата за это; очереди рассчитаны на десятки строк, и
   * отдельный запрос за одним числом стоил бы столько же.
   */
  const [exchange, withdrawals, cards, conversations] = await Promise.all([
    // Счётом, а не длиной выборки: у очереди есть предел страницы, и
    // счётчик по ней застыл бы на нём ровно тогда, когда очередь
    // выросла и число стало нужно.
    core.countExchangeRequestQueue(actor),
    core.listWithdrawalQueue(actor),
    core.listCardApplicationQueue(actor),
    // Обращения считаются запросом за числом, а не выборкой ленты: у
    // очередей строк десятки, а сообщений в переписке накапливаются
    // тысячи, и тянуть их ради счётчика нельзя.
    core.countUnansweredConversations(actor),
  ]);

  return (
    <div className="shell">
      <Sidebar
        counts={{
          exchange,
          withdrawals: withdrawals.length,
          cards: cards.length,
          conversations,
        }}
      />
      <div className="shell__main">
        <Topbar displayName={displayName} role={actor.role} />
        {children}
      </div>
    </div>
  );
}
