import { randomInt } from 'node:crypto';

/**
 * Реферальный код — то, что клиент вставляет в ссылку и рассылает
 * знакомым.
 *
 * Он случайный, а не производный от `telegram_user_id`: ссылка уходит
 * в чужие руки, и идентификатор клиента из неё вычитываться не должен.
 * Побочное следствие — самопривязка невозможна по построению: в момент
 * первой регистрации своего кода у клиента ещё нет.
 *
 * Алфавит без `0`, `O`, `1`, `I`: код читают с экрана и передают
 * голосом, и пара похожих символов стоит дороже, чем два бита энтропии.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 10;

export function generateReferralCode(): string {
  let code = '';
  for (let index = 0; index < LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}
