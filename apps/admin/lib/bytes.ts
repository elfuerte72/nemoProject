/**
 * Первые байты файла. Тип файла узнаётся по ним, а не со слов того, кто
 * файл прислал: так читаются и вложения клиента, и документы
 * администратора в базу знаний.
 */

export function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  return bytesAt(bytes, offset, [...expected].map((char) => char.charCodeAt(0)));
}

export function bytesAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}
