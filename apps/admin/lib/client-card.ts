import type { ClientCardView } from '@nemo/core';
import type { ClientCardData } from '@/app/ui/client-card';

/**
 * Карточка клиента из ядра — в вид, который переживает границу сервера.
 *
 * `bigint` и `Date` в клиентский компонент не переезжают, а карточка
 * стоит на трёх экранах: разговор, заявка, сам клиент. Перевод один на
 * все три — иначе поле, добавленное в ядро, доезжает до одного экрана
 * и не доезжает до двух остальных.
 */
export function toClientCardData(card: ClientCardView): ClientCardData {
  return {
    telegramUserId: card.telegramUserId.toString(),
    username: card.username,
    createdAt: card.createdAt.toISOString(),
    referralCode: card.referralCode,
    referrerId: card.referrerId?.toString() ?? null,
    referrerUsername: card.referrerUsername,
    marketingConsent: card.marketingConsent,
    stats: {
      completed: card.stats.completed,
      open: card.stats.open,
      cancelled: card.stats.cancelled,
      lastRequestAt: card.stats.lastRequestAt?.toISOString() ?? null,
      turnover: card.stats.turnover.map((line) => ({
        code: line.code,
        amount: line.amount,
        count: line.count,
      })),
      regular: card.stats.regular,
      invitedLine1: card.stats.invitedLine1,
      invitedLine2: card.stats.invitedLine2,
      referralEarned: card.stats.referralEarned,
    },
  };
}
