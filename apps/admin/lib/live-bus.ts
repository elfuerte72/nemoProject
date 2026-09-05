import type { LiveEvent } from '@nemo/core';
import { getCore } from '@/lib/core';

/**
 * Один слушатель базы на процесс, много открытых вкладок.
 *
 * Подписка на канал Postgres занимает соединение целиком, и заводить её
 * на каждую открытую вкладку значит держать столько соединений, сколько
 * менеджеров сегодня работает. Поэтому слушает процесс, а вкладки
 * получают событие уже отсюда.
 *
 * Держится на `globalThis` по той же причине, что и сам модуль
 * операций: в разработке Next пересобирает модуль на каждую правку, и
 * переменная обнулялась бы вместе с ним — а подписка оставалась бы
 * висеть на своём соединении.
 *
 * Последний ушедший гасит свет: без слушателей подписка закрывается, и
 * простаивающий процесс не держит соединения впустую.
 */

const KEY = Symbol.for('nemo.admin.live-bus');

interface Bus {
  readonly listeners: Set<(event: LiveEvent) => void>;
  /** Заводится при первом слушателе; закрывает подписку в базе. */
  stop?: (() => Promise<void>) | undefined;
  /** Пока подписка ещё заводится, второй слушатель ждёт эту же работу. */
  starting?: Promise<void> | undefined;
}

type Holder = typeof globalThis & { [KEY]?: Bus };

function bus(): Bus {
  const holder = globalThis as Holder;
  holder[KEY] ??= { listeners: new Set() };
  return holder[KEY];
}

/**
 * Слушать события. Возвращает то, чем подписку закрывают, — звать
 * обязательно: без этого закрытая вкладка навсегда осталась бы в
 * списке.
 */
export async function onLiveEvent(
  listener: (event: LiveEvent) => void,
): Promise<() => Promise<void>> {
  const current = bus();
  current.listeners.add(listener);

  if (!current.stop && !current.starting) {
    current.starting = (async () => {
      /*
       * Событие уходит каждому слушателю в своей попытке: вкладка,
       * закрывшаяся в этот самый момент, роняет запись в поток, а вслед
       * за ней уронила бы и рассылку остальным.
       */
      const stop = await getCore().subscribeToLiveEvents((event) => {
        for (const one of current.listeners) {
          try {
            one(event);
          } catch {
            // Молчим: этого слушателя уберёт его же поток, когда закроется.
          }
        }
      });
      current.stop = stop;
    })().finally(() => {
      current.starting = undefined;
    });
  }
  await current.starting;

  return async () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && current.stop) {
      const stop = current.stop;
      current.stop = undefined;
      await stop();
    }
  };
}
