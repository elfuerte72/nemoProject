import { requireClient, type Actor } from './actor.js';
import { listBonusTransactions, type BonusTransactionView } from './bonus-account.js';
import { listCardApplications, type ClientCardApplicationView } from './card-applications.js';
import { CLIENT_HISTORY_LIMIT } from './client-history.js';
import type { CoreConfig } from './context.js';
import { listExchangeRequests, type ExchangeRequestView } from './exchange-requests.js';
import { listWithdrawalRequests, type WithdrawalRequestView } from './withdrawals.js';

/**
 * Всё, что с клиентом происходило, одной лентой.
 *
 * Потоков четыре — заявки на обмен, движения по баллам, заявки на вывод
 * и на карту, — и до сих пор каждый жил в своём разделе. В отдельном
 * разделе истории они сходятся вместе, потому что клиент приходит туда
 * с вопросом «что было с моими деньгами», а не «покажи заявки на
 * вывод».
 *
 * Собирается лента здесь, а не в приложении. Четыре запроса из браузера
 * — это четыре круга по мобильной сети вместо одного, и на той же узкой
 * сети, ради которой соседние разделы заводятся в простое. Заодно
 * признак обрезки приходит от того, кто про потолок знает: приложению
 * незачем помнить его число, чтобы честно сказать о неполноте.
 *
 * Порядок — по времени, свежее сверху; чем запись была, говорит её
 * поток. Разнородность потоков лента не скрывает: сумма обмена, баллы и
 * шаг выпуска карты — разные вещи, и показываются они по-разному.
 */

export type ClientHistoryEntry =
  | { readonly stream: 'exchange'; readonly at: Date; readonly request: ExchangeRequestView }
  | { readonly stream: 'bonus'; readonly at: Date; readonly transaction: BonusTransactionView }
  | { readonly stream: 'withdrawal'; readonly at: Date; readonly request: WithdrawalRequestView }
  | {
      readonly stream: 'card';
      readonly at: Date;
      readonly application: ClientCardApplicationView;
    };

export interface ClientHistoryView {
  readonly entries: readonly ClientHistoryEntry[];
  /**
   * Уперся ли хоть один поток в свой потолок. Приложение говорит об этом
   * прямо: молча показанный кусок читается как «это всё, что было».
   */
  readonly truncated: boolean;
}

export async function getClientHistory(
  ctx: CoreConfig,
  actor: Actor,
): Promise<ClientHistoryView> {
  const clientId = requireClient(actor);

  const [exchanges, bonuses, withdrawals, cards] = await Promise.all([
    listExchangeRequests(ctx, actor),
    listBonusTransactions(ctx.db, clientId),
    listWithdrawalRequests(ctx, actor),
    listCardApplications(ctx, actor),
  ]);

  const entries: ClientHistoryEntry[] = [
    ...exchanges.map(
      (request): ClientHistoryEntry => ({ stream: 'exchange', at: request.createdAt, request }),
    ),
    ...bonuses.map(
      (transaction): ClientHistoryEntry => ({
        stream: 'bonus',
        at: transaction.createdAt,
        transaction,
      }),
    ),
    ...withdrawals.map(
      (request): ClientHistoryEntry => ({ stream: 'withdrawal', at: request.createdAt, request }),
    ),
    ...cards.map(
      (application): ClientHistoryEntry => ({
        stream: 'card',
        at: application.createdAt,
        application,
      }),
    ),
  ];

  // По времени подачи, а не последнего движения: лента отвечает на
  // вопрос «что происходило», и заявка, взятая менеджером сегодня, не
  // должна перепрыгивать наверх через сделанное после неё.
  entries.sort((one, other) => other.at.getTime() - one.at.getTime());

  return {
    entries,
    truncated: [exchanges, bonuses, withdrawals, cards].some(
      (stream) => stream.length >= CLIENT_HISTORY_LIMIT,
    ),
  };
}
