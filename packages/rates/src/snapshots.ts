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
  /**
   * Сколько раз прогрев пробует достучаться до провайдера.
   *
   * Больше одного, потому что провайдер отвечает рвано: у биржи замерено
   * от 0,15 до 12 секунд, а срок запроса — три. Одна попытка попадает на
   * медленный ответ и срывается, и тогда первый клиент видит «курс
   * назовёт менеджер» на пустом кэше — при том, что биржа жива.
   */
  readonly warmUpAttempts?: number;
  /**
   * Пауза перед следующей попыткой прогрева; растёт с её номером. Лежачий
   * провайдер не оживает от того, что в него стучат чаще.
   */
  readonly warmUpRetryMs?: number;
  /** Подменяется в тестах, чтобы проверить устаревание. */
  readonly now?: () => number;
}

/**
 * Четыре попытки с растущей паузой — это около двенадцати секунд, за
 * которые провайдер должен ответить хоть раз. Первый клиент приходит
 * заметно позже: между выкаткой и им проходит хотя бы столько же.
 */
const DEFAULT_WARM_UP_ATTEMPTS = 4;
const DEFAULT_WARM_UP_RETRY_MS = 2_000;

export interface SnapshotCache<T> {
  /**
   * Что показывать прямо сейчас — или что показывали в названный
   * момент. Пусто, когда показывать нечего: провайдер молчит с самого
   * запуска или последнее известное слишком старое.
   */
  read(at?: Date): Promise<Snapshot<T> | undefined>;
  /**
   * Сходить за данными, не дожидаясь первого клиента, — и не сдаваться с
   * первого отказа. Ждать прогрев некому, поэтому срок запроса ему не
   * указ: три секунды поставлены, чтобы биржу не ждал человек у экрана,
   * а здесь у экрана никого нет.
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
  /**
   * Начинался ли прогрев. Он один на кэш и на запуск процесса: второй
   * завёл бы свою цепочку попыток и удвоил стук в провайдера, у которого
   * есть предел обращений в минуту.
   */
  let warmUpStarted = false;

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
      if (warmUpStarted) return;
      warmUpStarted = true;

      const attempts = options.warmUpAttempts ?? DEFAULT_WARM_UP_ATTEMPTS;
      const retryMs = options.warmUpRetryMs ?? DEFAULT_WARM_UP_RETRY_MS;

      void (async () => {
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          // Снимок мог появиться и без прогрева — от клиента, пришедшего
          // раньше, чем провайдер ответил. Греть тогда нечего.
          if (newest()) return;

          try {
            await refresh();
            return;
          } catch (error) {
            console.error(`${options.provider} не ответила при прогреве`, error);
          }

          if (attempt < attempts) {
            await new Promise((resolve) => setTimeout(resolve, retryMs * attempt));
          }
        }
      })();
    },
  };
}
