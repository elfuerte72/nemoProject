import { cache } from 'react';
import type { StaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import type { NavCounts } from '@/lib/nav';

/**
 * Счётчики очередей — одни на запрос.
 *
 * Их читают двое: меню (в каркасе) и обзор на столе. Каркас и страница
 * рисуются раздельно, и без общей памяти каждый ходил бы в базу за
 * теми же четырьмя числами. `cache` из React живёт ровно один запрос:
 * второй вызов с тем же актором получает готовый ответ, а следующий
 * запрос считает заново — счётчики не залёживаются.
 */
export const panelCounts = cache(async (actor: StaffActor): Promise<NavCounts> => {
  const core = getCore();
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
  return {
    exchange,
    withdrawals: withdrawals.length,
    cards: cards.length,
    conversations,
  };
});
