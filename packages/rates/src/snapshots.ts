/**
 * Кэш снимков внешнего источника — общий для всех провайдеров курса.
 *
 * Правило у них одно и то же, и оно не про котировки, а про чужой
 * сервер: устаревшее отдаётся сразу, а за свежим уходят в фоне. Запрос
 * клиента не должен стоять в очереди за биржей — она отвечает от долей
 * секунды до десятков, и поставить её в путь ответа значит отдать ей
 * скорость приложения.
 *
 * Отсюда же и снимки во множественном числе: клиент подаёт заявку по
 * курсу, который увидел, и присылает отметку его времени. Ответить
 * именно тем курсом можно, только храня несколько снимков, — между
 * показом и нажатием кэш успевает обновиться.
 *
 * Провайдеров два, и логика ожидания у них одинаковая: живя в каждом
 * своей копией, она разошлась бы при первой же правке — а правка здесь
 * означает «кто-то ждёт чужой сервер дольше, чем думает».
 */

export interface Snapshot<T> {
  readonly at: number;
  readonly value: T;
}

export interface SnapshotCacheOptions<T> {
  /** Сходить к провайдеру. Ошибки не глушит: их обрабатывает кэш. */
  readonly load: () => Promise<T>;
  /** Через сколько снимок считается устаревшим и просит обновления. */
  readonly ttlMs: number;
  /** Насколько старый снимок ещё можно показывать, пока провайдер молчит. */
  readonly maxAgeMs: number;
  /** Сколько снимков помнить ради отметок времени в поданных заявках. */
  readonly keep: number;
  /** Чьё молчание попадёт в журнал. */
  readonly provider: string;
  /** Подменяется в тестах, чтобы проверить устаревание. */
  readonly now?: () => number;
}

export interface SnapshotCache<T> {
  /**
   * Что показывать прямо сейчас — или что показывали в названный
   * момент. Пусто, когда показывать нечего: провайдер молчит с самого
   * запуска или последнее известное слишком старое.
   */
  read(at?: Date): Promise<Snapshot<T> | undefined>;
  /**
   * Сходить за данными, не дожидаясь первого клиента. Единственное
   * ожидание, которое здесь остаётся, — первое обращение после
   * перезапуска процесса, и прогрев съедает его до того, как кто-то
   * придёт.
   */
  warmUp(): void;
}

export function createSnapshotCache<T>(options: SnapshotCacheOptions<T>): SnapshotCache<T> {
  const now = options.now ?? Date.now;

  /** Снимки, новейший последний. */
  const snapshots: Snapshot<T>[] = [];
  let inFlight: Promise<Snapshot<T>> | undefined;
  /**
   * Ждал ли уже кто-нибудь ответа на пустом кэше. Ожидание здесь ровно
   * одно на запуск процесса: пока показывать нечего, второй и третий
   * клиент ничего от своего ожидания не выигрывают.
   */
  let waited = false;

  const newest = (): Snapshot<T> | undefined => snapshots[snapshots.length - 1];

  /**
   * Обновление, которое никого не ждёт.
   *
   * Один запрос на всех, кто спросил, пока он идёт: даже склеенные,
   * запросы к чужому API нужны раз в срок жизни снимка, а не по числу
   * посетителей.
   */
  function refresh(): Promise<Snapshot<T>> {
    inFlight ??= options
      .load()
      .then((value) => {
        const snapshot: Snapshot<T> = { at: now(), value };
        snapshots.push(snapshot);
        if (snapshots.length > options.keep) snapshots.shift();
        return snapshot;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  async function current(): Promise<Snapshot<T> | undefined> {
    const known = newest();
    if (!known) {
      if (waited) {
        /*
         * Ждали и не дождались. Дальше не ждёт никто: пока провайдер
         * лежит, каждый следующий клиент платил бы за это своим сроком
         * ожидания — и платил бы зря, потому что ответ всё равно один и
         * тот же. Обновление уходит в фон, и первый удавшийся запрос
         * вернёт курс всем сразу.
         */
        void refresh().catch((error: unknown) => {
          console.error(`${options.provider} не ответила`, error);
        });
        return undefined;
      }

      // Показывать нечего вовсе — это первое обращение после запуска
      // процесса, и только здесь кто-то ждёт чужой сервер. В рабочем
      // деплое это ожидание съедает прогрев.
      waited = true;
      try {
        return await refresh();
      } catch (error) {
        // Недоступность провайдера — рабочее состояние, а не авария:
        // заявку клиент подаст и без курса, а курс назовёт менеджер.
        console.error(`${options.provider} не ответила`, error);
        return undefined;
      }
    }

    if (now() - known.at >= options.ttlMs) {
      // Ошибку здесь глушим намеренно: это фоновое обновление, и некому
      // её показать — тот, кто его вызвал, уже получил ответ.
      void refresh().catch((error: unknown) => {
        console.error(`${options.provider} не ответила`, error);
      });
    }
    return known;
  }

  return {
    async read(at?: Date): Promise<Snapshot<T> | undefined> {
      // Курс, который клиент видел, ищется среди снимков по отметке
      // времени. Не нашли — отвечаем текущим: отметка могла устареть из
      // памяти, и это не повод отказывать в подаче.
      const snapshot = (at && snapshots.find((one) => one.at === at.getTime())) ?? (await current());

      // Слишком старое не показывается: по такому курсу подают заявку, а
      // она обязательство сервиса.
      if (!snapshot || now() - snapshot.at > options.maxAgeMs) return undefined;
      return snapshot;
    },

    warmUp(): void {
      void refresh().catch((error: unknown) => {
        console.error(`${options.provider} не ответила при прогреве`, error);
      });
    },
  };
}
