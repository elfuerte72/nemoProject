import { sql } from 'drizzle-orm';
import type { CoreConfig, Executor } from './context.js';

/**
 * Толчок о том, что на экране панели что-то устарело.
 *
 * Панель перечитывает себя по таймеру раз в двадцать пять секунд, и для
 * очереди этого хватало. Для переписки — нет: клиент пишет и ждёт
 * ответа сейчас, а менеджер узнавал о сообщении из уведомления в
 * Telegram и шёл обновлять страницу руками. Толчок закрывает эту
 * разницу: событие доходит до открытой вкладки за секунду.
 *
 * Канал — сам Postgres (`LISTEN`/`NOTIFY`), а не запрос по сети между
 * деплоями. Событие рождается там, где меняется состояние, а меняют
 * его оба приложения: сообщение клиента записывает клиентский деплой,
 * переход по заявке — панель. База — единственное, что у них общее, и
 * она же решает, состоялось событие или откатилось: `pg_notify` внутри
 * транзакции уходит подписчикам при коммите, а не до него.
 *
 * Толчок — ускорение, а не доставка. Он теряется при обрыве соединения
 * и на пересборке подписки, и это допустимо ровно потому, что таймер
 * остаётся на месте: потерянное событие стоит менеджеру тех же
 * двадцати пяти секунд, что и раньше.
 */

export const LIVE_CHANNEL = 'nemo_live';

/**
 * О чём событие. Не «что именно изменилось»: панель по толчку
 * перечитывает экран целиком, и подробности ей ни к чему — а вот
 * обновлять карточку заявки на каждое чужое сообщение в переписке
 * незачем.
 */
export const LIVE_TOPICS = ['conversations', 'exchange'] as const;

export type LiveTopic = (typeof LIVE_TOPICS)[number];

export interface LiveEvent {
  readonly topic: LiveTopic;
  /**
   * Чей разговор задет. Только у переписки и только для тех экранов,
   * которые показывают одного клиента: список обращений обновляется на
   * любое сообщение.
   */
  readonly clientId?: string | undefined;
}

/**
 * Сказать открытым вкладкам, что экран устарел.
 *
 * Зовётся внутри той же транзакции, что и само изменение: `pg_notify`
 * доставляется по коммиту, и подписчик не увидит события, которого в
 * базе не случилось. Отказ канала не роняет операцию — обмен, который
 * не состоялся из-за того, что некому было о нём рассказать, хуже
 * молчания.
 */
export async function publishLiveEvent(executor: Executor, event: LiveEvent): Promise<void> {
  try {
    await executor.execute(sql`select pg_notify(${LIVE_CHANNEL}, ${JSON.stringify(event)})`);
  } catch {
    // Молчим намеренно: см. выше.
  }
}

function parseEvent(payload: string): LiveEvent | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { topic, clientId } = parsed as { topic?: unknown; clientId?: unknown };
    // Канал общий на всю базу: чужой `NOTIFY` в него тоже придёт, и
    // разбирать его как своё — значит будить панель на пустом месте.
    if (!LIVE_TOPICS.includes(topic as LiveTopic)) return undefined;
    return {
      topic: topic as LiveTopic,
      ...(typeof clientId === 'string' ? { clientId } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Слушать события. Возвращает то, чем подписку закрывают.
 *
 * Соединение под подпиской — своё: `LISTEN` занимает его целиком, и
 * взятое из пула оно перестало бы отдавать запросы. Поэтому подписка в
 * процессе одна, а раздаёт её открытым вкладкам сам процесс.
 *
 * Обрыв связи с базой `postgres.js` переживает сам и подписывается
 * заново; пропущенное за это время не догоняется — за него отвечает
 * таймер панели.
 */
export async function subscribeToLiveEvents(
  ctx: CoreConfig,
  handler: (event: LiveEvent) => void,
): Promise<() => Promise<void>> {
  const client = ctx.db.$client;
  const subscription = await client.listen(LIVE_CHANNEL, (payload) => {
    const event = parseEvent(payload);
    if (event) handler(event);
  });

  return async () => {
    await subscription.unlisten();
  };
}
