import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Одноразовые коды по RFC 6238 — второй фактор входа сотрудника.
 *
 * Собственная реализация вместо библиотеки: алгоритм — тридцать строк
 * и набор официальных тестовых векторов, а зависимость в контуре, где
 * лежат чужие номера карт, стоит дороже этих строк.
 *
 * SHA-1 здесь не уступка старому: он зафиксирован RFC и именно его ждут
 * приложения-аутентификаторы. Стойкость схемы держится на секрете и
 * коротком окне, а не на хеше.
 */

const PERIOD_SECONDS = 30;
const DEFAULT_DIGITS = 6;
/** Сколько шагов назад принимается код: человек набирает его не мгновенно. */
const DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export interface TotpOptions {
  readonly now?: Date;
  readonly digits?: number;
  /** Сколько шагов назад ещё принимать. Вперёд принимается один шаг. */
  readonly window?: number;
}

export function totpCode(secretBase32: string, options: TotpOptions = {}): string {
  const digits = options.digits ?? DEFAULT_DIGITS;
  const now = options.now ?? new Date();
  const counter = BigInt(Math.floor(now.getTime() / 1000 / PERIOD_SECONDS));
  return hotp(base32Decode(secretBase32), counter, digits);
}

/**
 * Сравнение постоянного времени: код короткий, и разница в скорости
 * ответа сузила бы перебор.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: TotpOptions = {},
): boolean {
  const digits = options.digits ?? DEFAULT_DIGITS;
  const window = options.window ?? DEFAULT_WINDOW;
  const now = options.now ?? new Date();

  const cleaned = code.replace(/\s/g, '');
  if (cleaned.length !== digits || !/^\d+$/.test(cleaned)) {
    return false;
  }

  const current = Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);
  const secret = base32Decode(secretBase32);
  const supplied = Buffer.from(cleaned, 'utf8');

  let matched = false;
  // Проверяются все шаги окна без досрочного выхода: выход по первому
  // совпадению выдал бы временем, насколько код разошёлся с текущим.
  for (let step = -window; step <= 1; step += 1) {
    const expected = Buffer.from(hotp(secret, BigInt(current + step), digits), 'utf8');
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) {
      matched = true;
    }
  }
  return matched;
}

function hotp(secret: Buffer, counter: bigint, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', secret).update(message).digest();

  // Динамическое усечение из RFC 4226: младшие четыре бита последнего
  // байта указывают, откуда брать четыре байта кода.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return String(binary % 10 ** digits).padStart(digits, '0');
}

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of input.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new RangeError(`Не base32: ${character}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
