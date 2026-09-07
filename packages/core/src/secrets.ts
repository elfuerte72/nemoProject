import { randomBytes } from 'node:crypto';

/**
 * Случайная строка из букв и цифр — тело ключа API и секрета вебхука.
 *
 * Без дефисов и подчёркиваний нарочно: секрет копируют двойным
 * щелчком, и на дефисе выделение обрывается. Тридцать два знака —
 * около 190 бит случайности: столько не перебрать.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomAlphanumeric(length: number): string {
  // Байты от 248 отбрасываются: 256 не делится на 62 нацело, и без
  // этого первые восемь букв алфавита выпадали бы чаще остальных.
  const limit = 256 - (256 % ALPHABET.length);
  let body = '';
  while (body.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      body += ALPHABET[byte % ALPHABET.length];
      if (body.length === length) break;
    }
  }
  return body;
}
