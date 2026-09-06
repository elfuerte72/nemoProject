/**
 * Счётчик попыток входа — по почте и по адресу, в памяти процесса.
 *
 * Пароль здесь единственный фактор (второй записан в `backlog.md`), и
 * без счёта попыток форма входа — это способ перебирать пароли со
 * скоростью сети. Считается и почта, и адрес: по почте — чтобы не
 * подбирали пароль к одному аккаунту, по адресу — чтобы не подбирали
 * почты списком.
 *
 * В памяти, а не в базе: запись на каждую неудачную попытку — это
 * запись, которую делает кто угодно снаружи. Процессов у кабинета
 * бывает несколько, и тогда предел умножается на их число; для того,
 * от чего эта мера защищает — перебора с одной машины, — этого хватает,
 * а общий счётчик в базе стоил бы тех самых записей.
 *
 * Правило живёт отдельно от маршрута и покрыто тестом: проверить его
 * руками — это пятнадцать неудачных входов подряд.
 */

/** Сколько попыток даётся за окно и какой длины окно. */
export const ATTEMPT_LIMIT = 10;
export const ATTEMPT_WINDOW_MS = 15 * 60_000;

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

/**
 * Осталась ли попытка. Спрашивается до проверки пароля: считать надо
 * попытки, а не удачные входы.
 */
export function attemptAllowed(key: string, now: number = Date.now()): boolean {
  const bucket = buckets().get(key);
  if (!bucket || bucket.resetAt <= now) return true;
  return bucket.count < ATTEMPT_LIMIT;
}

/** Неудачная попытка. Удачная счётчик не трогает — она его снимает. */
export function attemptFailed(key: string, now: number = Date.now()): void {
  const map = buckets();
  const bucket = map.get(key);
  if (!bucket || bucket.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

/** Вошёл — счёт обнуляется: считаем перебор, а не забывчивость. */
export function attemptSucceeded(key: string): void {
  buckets().delete(key);
}

/** Забыть всё: нужно тестам, которым иначе мешает предыдущий. */
export function forgetAttempts(): void {
  buckets().clear();
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
