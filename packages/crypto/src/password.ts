import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Пароль мерчанта — argon2id.
 *
 * Мерчант входит в кабинет почтой и паролем: Telegram, которым опознан
 * клиент, у бизнеса нет (docs/adr/0017). Угнанный аккаунт означает
 * подменённые реквизиты получателя — платит по ним сам мерчант, — и
 * подбор по утёкшей базе должен стоить дороже добычи.
 *
 * argon2id, а не быстрый хеш: он требует памяти, и видеокарта, на
 * которой перебор SHA идёт миллиардами в секунду, здесь упирается в
 * гигабайты. Параметры — те, что OWASP называет минимальными: 19 МиБ,
 * три прохода, один поток. Проверка занимает десятки миллисекунд —
 * столько человек ждать согласен, а перебор на этом захлёбывается.
 *
 * Считает их `hash-wasm`, а не нативный модуль: пакет ходит в оба
 * приложения Next, и собранный под чужую платформу бинарник ломал бы
 * выкатку молча. WebAssembly едет внутри самого пакета и не зависит от
 * системы, на которой его собрали.
 *
 * Соль своя у каждого пароля и лежит внутри строки хеша вместе с
 * параметрами: по ней проверка знает, чем считать, и смена параметров
 * не обесценивает уже сохранённые пароли.
 */

const SALT_BYTES = 16;
const HASH_BYTES = 32;
/** Память в кибибайтах: 19 МиБ — нижняя граница из рекомендаций OWASP. */
const MEMORY_KIB = 19_456;
const ITERATIONS = 3;
const PARALLELISM = 1;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(SALT_BYTES),
    parallelism: PARALLELISM,
    iterations: ITERATIONS,
    memorySize: MEMORY_KIB,
    hashLength: HASH_BYTES,
    outputType: 'encoded',
  });
}

/**
 * Подходит ли пароль к сохранённому хешу.
 *
 * Испорченная строка — «не подходит», а не исключение: разбирать её
 * пришлось бы каждому вызывающему, а ответ у всех один. Пятисотый ответ
 * на форме входа человек читает как поломку сервиса и повторяет попытку,
 * вместо того чтобы вспомнить пароль.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}
