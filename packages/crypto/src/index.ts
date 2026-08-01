import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

/**
 * Асимметричное шифрование реквизитов клиента (docs/adr/0002).
 *
 * Клиентское приложение получает только публичный ключ: оно может
 * записать реквизиты, но не прочитать ни своих, ни чужих. Приватный ключ
 * живёт исключительно в деплое админ-панели, поэтому компрометация
 * публичной части не открывает базу номеров карт.
 *
 * Схема: эфемерная пара X25519 на каждое сообщение → общий секрет →
 * HKDF-SHA256 → AES-256-GCM. Эфемерность даёт прямую секретность:
 * утечка приватного ключа не расшифровывает перехваченные ранее конверты
 * без него самого, а компрометация одного конверта не задевает остальные.
 */

const VERSION = 1;
const EPHEMERAL_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HKDF_INFO = 'nemo:requisites:v1';

/** Непрозрачный конверт: версия ‖ эфемерный ключ ‖ iv ‖ tag ‖ шифротекст. */
export type SealedEnvelope = Buffer & { readonly __brand: 'SealedEnvelope' };

export interface RequisiteKeyPair {
  /** Едет в клиентское приложение. Публиковать безопасно. */
  publicKey: string;
  /** Только в деплое админ-панели. */
  privateKey: string;
}

/** Разовая операция при развёртывании: выпустить пару ключей. */
export function generateRequisiteKeyPair(): RequisiteKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function rawPublicKey(key: KeyObject): Buffer {
  // DER для X25519 — 12 байт заголовка и 32 байта самого ключа.
  return key.export({ type: 'spki', format: 'der' }).subarray(-EPHEMERAL_KEY_LENGTH);
}

function publicKeyFromRaw(raw: Buffer): KeyObject {
  const header = Buffer.from('302a300506032b656e032100', 'hex');
  return createPublicKey({
    key: Buffer.concat([header, raw]),
    format: 'der',
    type: 'spki',
  });
}

function deriveKey(sharedSecret: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', sharedSecret, salt, HKDF_INFO, KEY_LENGTH));
}

/** Зашифровать реквизит. Требует только публичный ключ. */
export function seal(publicKeyPem: string, plaintext: string): SealedEnvelope {
  const recipient = createPublicKey(publicKeyPem);
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralRaw = rawPublicKey(ephemeral.publicKey);

  const sharedSecret = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipient,
  });
  const key = deriveKey(sharedSecret, ephemeralRaw);

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return Buffer.concat([
    Buffer.of(VERSION),
    ephemeralRaw,
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]) as SealedEnvelope;
}

/** Расшифровать реквизит. Доступно только там, где есть приватный ключ. */
export function open(privateKeyPem: string, envelope: Buffer): string {
  const minimum = 1 + EPHEMERAL_KEY_LENGTH + IV_LENGTH + TAG_LENGTH;
  if (envelope.length < minimum) {
    throw new RangeError('Конверт короче минимально допустимого');
  }
  if (envelope[0] !== VERSION) {
    throw new RangeError(`Неизвестная версия конверта: ${String(envelope[0])}`);
  }

  let offset = 1;
  const ephemeralRaw = envelope.subarray(offset, (offset += EPHEMERAL_KEY_LENGTH));
  const iv = envelope.subarray(offset, (offset += IV_LENGTH));
  const tag = envelope.subarray(offset, (offset += TAG_LENGTH));
  const ciphertext = envelope.subarray(offset);

  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey(privateKeyPem),
    publicKey: publicKeyFromRaw(Buffer.from(ephemeralRaw)),
  });
  const key = deriveKey(sharedSecret, Buffer.from(ephemeralRaw));

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Последние четыре цифры — единственное, что хранится в открытом виде,
 * чтобы клиент узнавал свою карту, а менеджер различал реквизиты в списке.
 */
export function lastFour(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 4) {
    throw new RangeError('В номере карты меньше четырёх цифр');
  }
  return digits.slice(-4);
}
