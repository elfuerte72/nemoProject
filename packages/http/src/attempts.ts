/**
 * Счётчик попыток — по ключу, в памяти процесса.
 *
 * Один на приложения: кабинет считает им вход мерчанта по паролю,
 * панель — коды второго фактора у сотрудника. Предел и окно называет
 * тот, кто счётчик заводит: пароль и шестизначный код перебирают с
 * разной ценой промаха.
 *
 * В памяти, а не в базе: запись на каждую попытку — это запись, которую
 * делает кто угодно снаружи. Процессов у приложения бывает несколько, и
 * тогда предел умножается на их число; от перебора этого хватает, а
 * общий счётчик в базе стоил бы тех самых записей.
 *
 * Окно отсчитывается от первой попытки и последующими не продлевается:
 * иначе стучащий раз в минуту держал бы чужой вход закрытым вечно.
 */

export interface AttemptCounterOptions {
  /**
   * Под этим именем память лежит на `globalThis`. Next собирает маршруты
   * в разные бандлы и пересобирает модули в разработке — с переменной
   * модуля счётчик обнулялся бы на каждой правке, а предел умножался бы
   * на число бандлов.
   */
  readonly name: string;
  /** Сколько попыток даётся за окно. */
  readonly limit: number;
  readonly windowMs: number;
}

export interface AttemptCounter {
  /** Осталась ли попытка. Спрашивается до дорогой работы: считать надо попытки, а не удачи. */
  allowed(key: string, now?: number): boolean;
  /** Попытка потрачена. */
  spent(key: string, now?: number): void;
  /**
   * Проверить предел и потратить попытку одним шагом. Возвращает, какой
   * по счёту стала попытка, или `null`, если попыток не осталось.
   *
   * Нужен там, где между проверкой и исходом стоит обращение к базе:
   * «спросить, потом потратить» пропускает параллельные запросы все
   * разом — каждый видит счёт, который ещё не успел вырасти.
   */
  reserve(key: string, now?: number): number | null;
  /** Вернуть попытку, которая попыткой не оказалась: отказала база, а не ключ. */
  release(key: string, now?: number): void;
  /** Удача счёт снимает: считается перебор, а не забывчивость. */
  succeeded(key: string): void;
  /** Забыть всё: нужно тестам, которым иначе мешает предыдущий. */
  forget(): void;
  /** Сколько ключей помнится. Наружу — только затем, чтобы это проверял тест. */
  size(): number;
}

/**
 * Сколько ключей помнить. Ключ приходит снаружи — почтой из формы, — и
 * без потолка память растёт от одного цикла по случайным адресам.
 * Тысячи хватает: столько разных ключей за окно не приходит ни от кого,
 * кроме перебирающего, а ему потолок и адресован.
 */
const KEYS_KEPT = 1000;

/** Длина ключа. Почта длиннее ста знаков — уже не почта, а нагрузка. */
const KEY_LIMIT = 120;

interface Bucket {
  count: number;
  /** Когда окно откроется заново. */
  resetAt: number;
}

type Holder = typeof globalThis & { [name: symbol]: Map<string, Bucket> | undefined };

export function createAttemptCounter(options: AttemptCounterOptions): AttemptCounter {
  const slot = Symbol.for(options.name);

  function buckets(): Map<string, Bucket> {
    const holder = globalThis as Holder;
    holder[slot] ??= new Map();
    return holder[slot];
  }

  return {
    allowed(key, now = Date.now()) {
      const bucket = buckets().get(shorten(key));
      if (!bucket || bucket.resetAt <= now) return true;
      return bucket.count < options.limit;
    },

    spent(key, now = Date.now()) {
      const map = buckets();
      sweep(map, now);

      const shortened = shorten(key);
      const bucket = map.get(shortened);
      if (!bucket || bucket.resetAt <= now) {
        map.set(shortened, { count: 1, resetAt: now + options.windowMs });
        return;
      }
      bucket.count += 1;
    },

    reserve(key, now = Date.now()) {
      const map = buckets();
      sweep(map, now);

      const shortened = shorten(key);
      const bucket = map.get(shortened);
      if (!bucket || bucket.resetAt <= now) {
        map.set(shortened, { count: 1, resetAt: now + options.windowMs });
        return 1;
      }
      if (bucket.count >= options.limit) return null;
      bucket.count += 1;
      return bucket.count;
    },

    release(key, now = Date.now()) {
      const bucket = buckets().get(shorten(key));
      if (!bucket || bucket.resetAt <= now) return;
      bucket.count = Math.max(0, bucket.count - 1);
    },

    succeeded(key) {
      buckets().delete(shorten(key));
    },

    forget() {
      buckets().clear();
    },

    size() {
      return buckets().size;
    },
  };
}

function shorten(key: string): string {
  return key.length > KEY_LIMIT ? key.slice(0, KEY_LIMIT) : key;
}

/**
 * Просроченные ключи — вон, и, если их всё равно много, самые старые
 * тоже. Чистится на записи, а не по таймеру: таймер в serverless живёт
 * не дольше запроса, а записи здесь и так делает только тот, кто
 * счётчик и наполняет.
 */
function sweep(map: Map<string, Bucket>, now: number): void {
  if (map.size < KEYS_KEPT) return;

  for (const [key, bucket] of map) {
    if (bucket.resetAt <= now) map.delete(key);
  }

  // Всё ещё много — значит окно живое у всех, и тогда уходят те, чьё
  // окно закроется раньше: их счёт всё равно вот-вот обнулится.
  if (map.size >= KEYS_KEPT) {
    const oldest = [...map.entries()]
      .sort((left, right) => left[1].resetAt - right[1].resetAt)
      .slice(0, map.size - KEYS_KEPT + 1);
    for (const [key] of oldest) map.delete(key);
  }
}
