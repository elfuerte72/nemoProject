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
 * базе не случилось.
 *
 * Отказ не глушится, хотя соблазн велик — «уведомление не важнее
 * обмена». Внутри транзакции глушить его нечестно: упавший запрос
 * рвёт саму транзакцию, и следующая же запись в ней откажет с
 * невнятным «current transaction is aborted». Падать здесь по правде
 * не на чем: размер события известен и до предела в восемь килобайт
 * ему далеко, а обрыв связи означает, что операция не завершится и
 * без нас.
 */
export async function publishLiveEvent(executor: Executor, event: LiveEvent): Promise<void> {
  await executor.execute(sql`select pg_notify(${LIVE_CHANNEL}, ${JSON.stringify(event)})`);
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

type LiveHandler = (event: LiveEvent) => void;

interface LiveChannel {
  /** Кому раздавать события: открытые вкладки панели. */
  readonly handlers: Set<LiveHandler>;
  /** Заведение подписки. Пусто — ещё не заводили или прошлая попытка отказала. */
  started: Promise<void> | undefined;
}

/*
 * Подписка одна на процесс и на всю его жизнь, а слушателей у неё
 * сколько угодно.
 *
 * `LISTEN` занимает соединение целиком, и подписка на вкладку означала
 * бы столько соединений к базе, сколько менеджеров сегодня работает.
 *
 * Снимать её, когда ушёл последний слушатель, нельзя, хотя и хочется:
 * `unlisten` из `postgres.js` замкнут на объект подписки, а после
 * обрыва связи библиотека подписывается заново и заводит новый —
 * старый `unlisten` при этом молча не находит себя и ничего не
 * снимает. Вторая подписка на тот же канал после такого молчания
 * доставляла бы каждое событие дважды, третья — трижды: 5 сентября
 * 2026 живая проба показала ровно это. Плата за отказ от снятия —
 * одно соединение к базе на процесс, в котором панель хоть раз
 * открывали; закрывается оно вместе с самим процессом.
 *
 * Реестр — на `globalThis`, как и модуль операций: Next пересобирает
 * модули в разработке и собирает бандлы врозь, и переменная модуля
 * дала бы по подписке на каждую копию.
 */
const CHANNELS = Symbol.for('nemo.core.live-channels');

type ChannelHolder = typeof globalThis & { [CHANNELS]?: WeakMap<object, LiveChannel> };

function channelFor(client: object): LiveChannel {
  const holder = globalThis as ChannelHolder;
  holder[CHANNELS] ??= new WeakMap();
  let channel = holder[CHANNELS].get(client);
  if (!channel) {
    channel = { handlers: new Set(), started: undefined };
    holder[CHANNELS].set(client, channel);
  }
  return channel;
}

/**
 * Слушать события. Возвращает то, чем слушателя снимают.
 *
 * Снимается именно слушатель, а не подписка в базе: она заводится один
 * раз и живёт до конца процесса (см. выше). Обрыв связи `postgres.js`
 * переживает сам и подписывается заново; пропущенное за это время не
 * догоняется — за него отвечает таймер панели.
 */
export async function subscribeToLiveEvents(
  ctx: CoreConfig,
  handler: LiveHandler,
): Promise<() => Promise<void>> {
  const client = ctx.db.$client;
  const channel = channelFor(client);
  channel.handlers.add(handler);

  channel.started ??= (async () => {
    await client.listen(LIVE_CHANNEL, (payload) => {
      const event = parseEvent(payload);
      if (!event) return;
      /*
       * Каждому слушателю — своя попытка: вкладка, закрывшаяся в этот
       * самый момент, роняет запись в свой поток, а вслед за ней
       * уронила бы и рассылку остальным.
       */
      for (const one of channel.handlers) {
        try {
          one(event);
        } catch {
          // Молчим: этого слушателя снимет его же поток, когда закроется.
        }
      }
    });
  })();

  try {
    await channel.started;
  } catch (error) {
    // Подписка не завелась — слушатель не остаётся висеть, а следующий
    // пришедший пробует завести её заново.
    channel.handlers.delete(handler);
    channel.started = undefined;
    throw error;
  }

  return async () => {
    channel.handlers.delete(handler);
  };
}
