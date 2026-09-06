/**
 * Счётчик попыток — по почте и по адресу, в памяти процесса.
 *
 * Пароль здесь единственный фактор (второй записан в `backlog.md`), и
 * без счёта попыток форма входа — это способ перебирать пароли со
 * скоростью сети. Считается и почта, и адрес: по почте — чтобы не
 * подбирали пароль к одному аккаунту, по адресу — чтобы не подбирали
 * почты списком.
 *
 * Тем же счётчиком закрыты заведение анкеты и просьба о письме: обе
 * стоят сервису дорого — argon2id намеренно занимает десятки
 * миллисекунд процессора, а письмо уходит на адрес, который назвал
 * запрашивающий. Без предела это разгон процессора и рассылка чужими
 * руками с нашего домена.
 *
 * В памяти, а не в базе: запись на каждую попытку — это запись, которую
 * делает кто угодно снаружи. Процессов у кабинета бывает несколько, и
 * тогда предел умножается на их число; от перебора с одной машины этого
 * хватает, а общий счётчик в базе стоил бы тех самых записей.
 *
 * Правило живёт отдельно от маршрута и покрыто тестом: проверить его
 * руками — это пятнадцать неудачных входов подряд.
 */

/** Сколько попыток даётся за окно и какой длины окно. */
export const ATTEMPT_LIMIT = 10;
export const ATTEMPT_WINDOW_MS = 15 * 60_000;

/**
 * Сколько ключей помнить. Ключ приходит снаружи — почтой из формы, — и
 * без потолка память растёт от одного цикла по случайным адресам.
 * Тысячи хватает: столько разных ящиков за четверть часа не приходит ни
 * от кого, кроме перебирающего, а ему потолок и адресован.
 */
const KEYS_KEPT = 1000;

/** Длина ключа. Почта длиннее ста знаков — уже не почта, а нагрузка. */
const KEY_LIMIT = 120;

interface Bucket {
  count: number;
  /** Когда окно откроется заново. */
  resetAt: number;
}

/**
 * Счётчики держатся на `globalThis` по той же причине, что и ядро: Next
 * пересобирает модули в разработке, и с переменной модуля счётчик
 * обнулялся бы на каждой правке.
 */
const KEY = Symbol.for('nemo.cabinet.attempts');
type Holder = typeof globalThis & { [KEY]?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  const holder = globalThis as Holder;
  holder[KEY] ??= new Map();
  return holder[KEY];
}

function shorten(key: string): string {
  return key.length > KEY_LIMIT ? key.slice(0, KEY_LIMIT) : key;
}

/**
 * Осталась ли попытка. Спрашивается до дорогой работы: считать надо
 * попытки, а не удачи.
 */
export function attemptAllowed(key: string, now: number = Date.now()): boolean {
  const bucket = buckets().get(shorten(key));
  if (!bucket || bucket.resetAt <= now) return true;
  return bucket.count < ATTEMPT_LIMIT;
}

/**
 * Попытка потрачена: неудачный вход, заведённая анкета, посланное
 * письмо. Удачный вход счётчик не тратит — он его снимает.
 */
export function attemptSpent(key: string, now: number = Date.now()): void {
  const map = buckets();
  sweep(map, now);

  const shortened = shorten(key);
  const bucket = map.get(shortened);
  if (!bucket || bucket.resetAt <= now) {
    map.set(shortened, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

/** Вошёл — счёт обнуляется: считаем перебор, а не забывчивость. */
export function attemptSucceeded(key: string): void {
  buckets().delete(shorten(key));
}

/** Забыть всё: нужно тестам, которым иначе мешает предыдущий. */
export function forgetAttempts(): void {
  buckets().clear();
}

/** Сколько ключей помнится. Наружу — только затем, чтобы это проверял тест. */
export function attemptCount(): number {
  return buckets().size;
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

/**
 * Адрес запроса за прокси. Берётся первый в цепочке `x-forwarded-for`:
 * он от клиента, остальные дописали посредники. Заголовка нет — считаем
 * все такие запросы одним источником: это не хуже, чем не считать их
 * вовсе.
 */
export function addressOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || 'неизвестный адрес';
}
